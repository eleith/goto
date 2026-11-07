import { validateConfig } from '@goto/config';
import type { LinkSummary } from '@goto/analytics';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readVisitSummary } from '#lib/server/visit-reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visit-reports.js', () => ({ readVisitSummary: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const domain = 'go.example.test';
function request(path = '/docs', host = domain, retention_months = 3) {
	const prepared = validateConfig(
		{
			auth: { credentials: { username: 'test', password: 'link-test-password' } },
			analytics: { retention_months },
			domains: {
				[domain]: {
					links: {
						'/docs': { url: 'https://example.test/docs' },
						'/a/b': { url: 'https://example.test/nested' },
						'/a%2Fb': { url: 'https://example.test/percent', enabled: false }
					}
				}
			}
		},
		{ env: {} }
	);
	return {
		locals: { snapshot: prepareSnapshot(prepared) },
		params: { domain: host, path: path.slice(1) }
	} as Parameters<typeof load>[0];
}
const summary: LinkSummary = {
	version: 1,
	scope: { kind: 'link', domain, path: '/docs' },
	period: {
		from: '2026-03-15T12:00:00.000Z',
		asOf: '2026-06-15T12:00:00.000Z',
		timezone: 'UTC',
		retentionMonths: 3
	},
	totals: { validVisits: 2, invalidVisits: 1 }
};

test('loads the requested path summary and current destination with a domain breadcrumb', async () => {
	vi.mocked(readVisitSummary).mockResolvedValue(summary);
	const data = await load(request());
	if (!data) throw new Error('Missing link page');
	expect(readVisitSummary).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
		kind: 'link',
		domain,
		path: '/docs'
	});
	expect(data.path).toBe('/docs');
	expect(data.totals).toEqual(summary.totals);
	expect(data.url).toBe('https://example.test/docs');
	expect(data.state).toBe('Active');
	expect(data.domainHref).toBe('/admin/domains/go.example.test');
	expect(data.asOf).toBe(Date.parse(summary.period.asOf));
	expect(data.retentionMonths).toBe(3);
});

test('keeps decoded nested and literal-percent paths distinct and supports the unconfigured root', async () => {
	vi.mocked(readVisitSummary)
		.mockResolvedValueOnce({ ...summary, scope: { kind: 'link', domain, path: '/a/b' } })
		.mockResolvedValueOnce({ ...summary, scope: { kind: 'link', domain, path: '/a%2Fb' } })
		.mockResolvedValueOnce({ ...summary, scope: { kind: 'link', domain, path: '/' } });
	const nested = await load(request('/a/b'));
	const percent = await load(request('/a%2Fb'));
	const root = await load(request('/'));
	if (!nested || !percent || !root) throw new Error('Missing path page');
	expect(nested.path).toBe('/a/b');
	expect(percent.path).toBe('/a%2Fb');
	expect(percent.state).toBe('Disabled');
	expect(readVisitSummary).toHaveBeenNthCalledWith(1, expect.any(Object), {
		kind: 'link',
		domain,
		path: '/a/b'
	});
	expect(readVisitSummary).toHaveBeenNthCalledWith(2, expect.any(Object), {
		kind: 'link',
		domain,
		path: '/a%2Fb'
	});
	expect(readVisitSummary).toHaveBeenNthCalledWith(3, expect.any(Object), {
		kind: 'link',
		domain,
		path: '/'
	});
	expect(root.path).toBe('/');
	expect(root.state).toBe('Fallback');
	expect(root.url).toBeNull();
	expect(root.fallback).toBe(404);
});

test('rejects unknown scopes before reading and keeps unavailable or disabled counts empty', async () => {
	await expect(load(request('/docs', 'unknown.test'))).rejects.toMatchObject({ status: 404 });
	await expect(load(request('/not-configured'))).rejects.toMatchObject({ status: 404 });
	expect(readVisitSummary).not.toHaveBeenCalled();
	vi.mocked(readVisitSummary).mockResolvedValue(null);
	const missing = await load(request());
	if (!missing) throw new Error('Missing unavailable page');
	expect(missing.available).toBe(false);
	expect(missing.totals).toBeNull();
	vi.clearAllMocks();
	const disabled = await load(request('/docs', domain, 0));
	if (!disabled) throw new Error('Missing disabled page');
	expect(disabled.collectionEnabled).toBe(false);
	expect(disabled.retentionMonths).toBe(0);
	expect(disabled.totals).toBeNull();
	expect(readVisitSummary).not.toHaveBeenCalled();
});
