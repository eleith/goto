import { loadConfig, type RedirectResponse } from '@goto/config';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Application } from '#lib/server/application.js';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readLastActivity } from '#lib/server/visits/reports.js';
import { readDomainLifetimeVisitTotals } from '#lib/server/visits/totals.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visits/reports.js', () => ({ readLastActivity: vi.fn() }));
vi.mock('#lib/server/visits/totals.js', () => ({ readDomainLifetimeVisitTotals: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const domain = 'go.example.test';
const root: RedirectResponse = {
	url: 'https://example.test/start',
	status_code: 301,
	forward_query: true
};
const fallback: RedirectResponse = {
	url: 'https://example.test/missing',
	status_code: 302,
	forward_query: false
};

function request({
	host = domain,
	retentionMonths = 0,
	configureRoot = true
}: { host?: string; retentionMonths?: 0 | 3; configureRoot?: boolean } = {}) {
	const snapshot = prepareSnapshot(
		loadConfig(
			{
				auth: { credentials: { username: 'test', password: 'domain-test-password' } },
				analytics: { retention_months: retentionMonths },
				fallback,
				domains: {
					[domain]: {
						...(configureRoot ? { root } : {}),
						links: {
							'/docs': { url: 'https://example.test/docs', enabled: false, max_visits: 2 },
							'/a%2Fb': { url: 'https://example.test/percent', max_visits: 8 }
						}
					}
				}
			},
			{ env: {} }
		)
	);
	const linkVisitCount = vi.fn((_domain: string, path: string) => (path === '/docs' ? 2 : 8));
	const application: Application = { currentSnapshot: () => snapshot, linkVisitCount };
	return {
		locals: { snapshot, application },
		params: { domain: host }
	} as Parameters<typeof load>[0];
}

test('shows stored domain and link totals at zero retention but uses live counts for link limits', async () => {
	vi.mocked(readDomainLifetimeVisitTotals).mockResolvedValueOnce({
		domain: { validVisits: 15, invalidVisits: 4 },
		byPath: new Map([
			['/', { validVisits: 3, invalidVisits: 0 }],
			['/docs', { validVisits: 1, invalidVisits: 0 }],
			['/a%2Fb', { validVisits: 7, invalidVisits: 0 }]
		])
	});
	const event = request();
	const data = await load(event);

	expect(readDomainLifetimeVisitTotals).toHaveBeenCalledExactlyOnceWith(
		expect.any(Object),
		domain,
		['/docs', '/a%2Fb']
	);
	expect(readLastActivity).not.toHaveBeenCalled();
	expect(data).toMatchObject({
		analyticsEnabled: false,
		lastActivityAt: null,
		linkCount: 2,
		totalVisits: 15,
		invalidClicks: 4,
		root,
		fallback
	});
	expect(data.links).toEqual([
		{
			path: '/',
			url: root.url,
			state: 'active',
			visits: 3,
			href: `/admin/domains/${domain}/links`
		},
		{
			path: '/docs',
			url: 'https://example.test/docs',
			state: 'disabled',
			visits: 1,
			href: `/admin/domains/${domain}/links/docs`
		},
		{
			path: '/a%2Fb',
			url: 'https://example.test/percent',
			state: 'exhausted',
			visits: 7,
			href: `/admin/domains/${domain}/links/a%252Fb`
		}
	]);
	expect(event.locals.application.linkVisitCount).toHaveBeenNthCalledWith(2, domain, '/a%2Fb');
});

test('rejects unknown domains before reading totals', async () => {
	await expect(load(request({ host: 'unknown.test' }))).rejects.toMatchObject({ status: 404 });
	expect(readDomainLifetimeVisitTotals).not.toHaveBeenCalled();
	expect(readLastActivity).not.toHaveBeenCalled();
});

test('keeps fallback, inventory and scoped activity available when totals cannot be read', async () => {
	const lastActivityAt = '2026-06-15T12:00:00.000Z';
	vi.mocked(readDomainLifetimeVisitTotals).mockResolvedValueOnce(null);
	vi.mocked(readLastActivity).mockResolvedValueOnce({ available: true, lastActivityAt });
	const data = await load(request({ retentionMonths: 3, configureRoot: false }));

	expect(readLastActivity).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
		kind: 'domain',
		domain
	});
	expect(data).toMatchObject({
		analyticsEnabled: true,
		lastActivityAt: Date.parse(lastActivityAt),
		root: null,
		fallback,
		totalVisits: null,
		invalidClicks: null
	});
	expect(data.links[0]).toMatchObject({ path: '/', url: fallback.url, visits: null });
});
