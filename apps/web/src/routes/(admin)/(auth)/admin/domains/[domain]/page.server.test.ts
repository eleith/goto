import { validateConfig } from '@goto/config';
import type { PreparedVisitReport, StoredVisitReports } from '@goto/db/visit-reports';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readVisitReport } from '#lib/server/visit-reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visit-reports.js', () => ({ readVisitReport: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const domain = 'go.example.test';
function request(host = domain, rootUrl?: string) {
	const links: Record<string, { url: string; enabled?: boolean }> = {
		'/docs': { url: 'https://example.test/docs' },
		'/a/b': { url: 'https://example.test/nested' },
		'/a%2Fb': { url: 'https://example.test/percent', enabled: false }
	};
	if (rootUrl) links['/'] = { url: rootUrl };
	const prepared = validateConfig(
		{
			auth: { credentials: { username: 'test', password: 'domain-test-password' } },
			domains: { [domain]: { links } }
		},
		{ env: {} }
	);
	return {
		locals: { snapshot: prepareSnapshot(prepared) },
		params: { domain: host }
	} as Parameters<typeof load>[0];
}
const docs = { total: 3, valid: 2, invalid: 1, base: 0 };
const root = { total: 1, valid: 0, invalid: 1, base: 1 };
const empty = { total: 0, valid: 0, invalid: 0, base: 0 };
const report: PreparedVisitReport = {
	totals: { total: 6, valid: 3, invalid: 3, base: 1 },
	daily: [],
	weekly: [],
	monthly: [],
	browsers: [],
	operatingSystems: [],
	domainCounts: [],
	linkCounts: [
		{ path: '/docs', counts: docs },
		{ path: '/', counts: root },
		{ path: '/a%2Fb', counts: empty }
	]
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

test('reads only domain-wide traffic and links to dedicated path routes', async () => {
	const reports: StoredVisitReports = { period, report, selection: report };
	vi.mocked(readVisitReport).mockResolvedValue(reports);
	const data = await load(request());
	if (!data) throw new Error('Missing page data');
	expect(readVisitReport).toHaveBeenCalledWith(expect.any(Object), domain);
	expect(data.totals).toEqual(report.totals);
	expect(data.invalidClicks).toBe(2);
	expect(data.linkCount).toBe(3);
	expect(data.retentionMonths).toBe(3);
	expect(data.links).toMatchObject([
		{ href: '/admin/domains/go.example.test/links/docs' },
		{ href: '/admin/domains/go.example.test/links/a/b' },
		{ href: '/admin/domains/go.example.test/links/a%252Fb' }
	]);
	expect(data.links[2]?.counts).toEqual(empty);
	expect(data.links[2]?.state).toBe('Disabled');
	expect(data.base.href).toBe('/admin/domains/go.example.test/links');
	expect(data.base.url).toBeNull();
	expect(data.base.state).toBe('Fallback');
	expect(data.base.counts).toEqual(root);
	expect(data.asOf).toBe(200);
});

test('shows an active base destination without reclassifying historical outcomes', async () => {
	vi.mocked(readVisitReport).mockResolvedValue({ period, report, selection: report });
	const data = await load(request(domain, 'https://example.test/start'));
	if (!data) throw new Error('Missing base page data');
	expect(data.base.url).toBe('https://example.test/start');
	expect(data.base.state).toBe('Active');
	expect(data.base.counts).toEqual(root);
});

test('excludes invalid base traffic without subtracting valid base redirects', async () => {
	const mixedRoot = { total: 5, valid: 3, invalid: 2, base: 5 };
	const mixedReport: PreparedVisitReport = {
		...report,
		totals: { total: 10, valid: 6, invalid: 4, base: 5 },
		linkCounts: report.linkCounts.map((row) =>
			row.path === '/' ? { ...row, counts: mixedRoot } : row
		)
	};
	vi.mocked(readVisitReport).mockResolvedValue({
		period,
		report: mixedReport,
		selection: mixedReport
	});
	const data = await load(request());
	if (!data) throw new Error('Missing domain page data');
	expect(data.invalidClicks).toBe(2);
	expect(data.totals?.valid).toBe(6);
});

test('rejects unknown domains before reading and preserves unavailable rather than zero', async () => {
	await expect(load(request('unknown.test'))).rejects.toMatchObject({ status: 404 });
	expect(readVisitReport).not.toHaveBeenCalled();
	vi.mocked(readVisitReport).mockResolvedValue(null);
	const data = await load(request());
	if (!data) throw new Error('Missing unavailable page');
	expect(data.available).toBe(false);
	expect(data.totals).toBeNull();
	expect(data.invalidClicks).toBeNull();
	expect(data.links[0]?.counts).toBeNull();
});
