import { loadConfig, type RedirectResponse } from '@goto/config';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readLastActivity } from '#lib/server/visits/reports.js';
import { readLifetimeVisitTotals } from '#lib/server/visits/totals.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visits/reports.js', () => ({ readLastActivity: vi.fn() }));
vi.mock('#lib/server/visits/totals.js', () => ({ readLifetimeVisitTotals: vi.fn() }));
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(readLifetimeVisitTotals).mockResolvedValue(null);
	vi.mocked(readLastActivity).mockResolvedValue({ available: false, lastActivityAt: null });
});

const domain = 'go.example.test';
const rootScope = { kind: 'link', domain, path: '/' };
const fallback: RedirectResponse = {
	url: 'https://example.test/fallback',
	status_code: 307,
	forward_query: true
};

function request({
	host = domain,
	root,
	fallbackSource = 'domain',
	retentionMonths = 3
}: {
	host?: string;
	root?: RedirectResponse;
	fallbackSource?: 'domain' | 'global' | 'builtin';
	retentionMonths?: 0 | 3;
} = {}) {
	const prepared = loadConfig(
		{
			auth: { credentials: { username: 'test', password: 'link-test-password' } },
			analytics: { retention_months: retentionMonths },
			link_defaults: { status_code: 301 },
			...(fallbackSource === 'global' ? { fallback } : {}),
			domains: {
				[domain]: {
					...(root ? { root } : {}),
					...(fallbackSource === 'domain' ? { fallback } : {}),
					link_defaults: { forward_query: true },
					links: {}
				}
			}
		},
		{ env: {} }
	);
	return {
		locals: { snapshot: prepareSnapshot(prepared) },
		params: { domain: host }
	} as Parameters<typeof load>[0];
}

test('reads lifetime Root totals and scoped activity even when Root uses fallback', async () => {
	const lastActivityAt = '2026-06-15T10:00:00.000Z';
	vi.mocked(readLifetimeVisitTotals).mockResolvedValue({ validVisits: 40, invalidVisits: 0 });
	vi.mocked(readLastActivity).mockResolvedValue({ available: true, lastActivityAt });

	expect(await load(request())).toEqual({
		domain,
		totalVisits: 40,
		domainHref: '/admin/domains/go.example.test',
		response: null,
		fallback,
		fallbackSource: 'domain',
		analyticsEnabled: true,
		lastActivityAt: Date.parse(lastActivityAt)
	});
	expect(readLifetimeVisitTotals).toHaveBeenCalledExactlyOnceWith(expect.any(Object), rootScope);
	expect(readLastActivity).toHaveBeenCalledExactlyOnceWith(expect.any(Object), rootScope);
});

test('keeps configured Root settings and activity when lifetime totals are unavailable', async () => {
	const root: RedirectResponse = {
		url: 'https://example.test/start',
		status_code: 302,
		forward_query: false
	};
	const lastActivityAt = '2026-06-15T10:00:00.000Z';
	vi.mocked(readLastActivity).mockResolvedValue({ available: true, lastActivityAt });

	expect(await load(request({ root }))).toMatchObject({
		totalVisits: null,
		lastActivityAt: Date.parse(lastActivityAt),
		response: root,
		fallback,
		fallbackSource: 'domain'
	});
});

test.each(['global', 'builtin'] as const)(
	'keeps Root totals and %s fallback at zero retention without reading activity',
	async (fallbackSource) => {
		vi.mocked(readLifetimeVisitTotals).mockResolvedValue({ validVisits: 40, invalidVisits: 0 });
		expect(await load(request({ retentionMonths: 0, fallbackSource }))).toMatchObject({
			totalVisits: 40,
			analyticsEnabled: false,
			lastActivityAt: null,
			response: null,
			fallback: fallbackSource === 'global' ? fallback : null,
			fallbackSource
		});
		expect(readLifetimeVisitTotals).toHaveBeenCalledExactlyOnceWith(expect.any(Object), rootScope);
		expect(readLastActivity).not.toHaveBeenCalled();
	}
);

test('rejects unknown domains before reading Root statistics', async () => {
	await expect(load(request({ host: 'unknown.test' }))).rejects.toMatchObject({ status: 404 });
	expect(readLifetimeVisitTotals).not.toHaveBeenCalled();
	expect(readLastActivity).not.toHaveBeenCalled();
});
