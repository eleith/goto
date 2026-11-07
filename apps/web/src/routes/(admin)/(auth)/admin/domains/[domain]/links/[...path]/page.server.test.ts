import { validateConfig } from '@goto/config';
import type { PreparedVisitReport } from '@goto/db/visit-reports';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readVisitReport } from '#lib/server/visit-reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visit-reports.js', () => ({ readVisitReport: vi.fn() }));
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
const report: PreparedVisitReport = {
	totals: { total: 6, valid: 3, invalid: 3, base: 1 },
	daily: [],
	weekly: [],
	monthly: [],
	browsers: [],
	operatingSystems: [],
	domainCounts: [],
	linkCounts: []
};
const period = {
	timezone: 'UTC' as const,
	retentionMonths: 3 as const,
	since: 100,
	asOf: 200,
	days: [],
	weeks: [],
	months: []
};

test('loads the requested path report and current destination with a domain breadcrumb', async () => {
	const totals = { total: 3, valid: 2, invalid: 1, base: 0 };
	vi.mocked(readVisitReport).mockResolvedValue({
		period,
		report,
		selection: { ...report, totals }
	});
	const data = await load(request());
	if (!data) throw new Error('Missing link page');
	expect(readVisitReport).toHaveBeenCalledWith(expect.any(Object), domain, '/docs');
	expect(data.path).toBe('/docs');
	expect(data.totals).toEqual(totals);
	expect(data.url).toBe('https://example.test/docs');
	expect(data.state).toBe('Active');
	expect(data.domainHref).toBe('/admin/domains/go.example.test');
	expect(data.asOf).toBe(200);
	expect(data.retentionMonths).toBe(3);
});

test('keeps decoded nested and literal-percent paths distinct and supports the unconfigured root', async () => {
	vi.mocked(readVisitReport).mockResolvedValue({ period, report, selection: report });
	const nested = await load(request('/a/b'));
	const percent = await load(request('/a%2Fb'));
	const root = await load(request('/'));
	if (!nested || !percent || !root) throw new Error('Missing path page');
	expect(nested.path).toBe('/a/b');
	expect(percent.path).toBe('/a%2Fb');
	expect(percent.state).toBe('Disabled');
	expect(readVisitReport).toHaveBeenCalledWith(expect.any(Object), domain, '/a%2Fb');
	expect(root.path).toBe('/');
	expect(root.state).toBe('Fallback');
	expect(root.url).toBeNull();
	expect(root.fallback).toBe(404);
});

test('rejects unknown scopes before reading and keeps unavailable or disabled counts empty', async () => {
	await expect(load(request('/docs', 'unknown.test'))).rejects.toMatchObject({ status: 404 });
	await expect(load(request('/not-configured'))).rejects.toMatchObject({ status: 404 });
	expect(readVisitReport).not.toHaveBeenCalled();
	vi.mocked(readVisitReport).mockResolvedValue(null);
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
	expect(readVisitReport).not.toHaveBeenCalled();
});
