import { validateConfig } from '@goto/config';
import type { DomainSummary } from '@goto/analytics';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readVisitSummary } from '#lib/server/visit-reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visit-reports.js', () => ({ readVisitSummary: vi.fn() }));
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
const docs = { validVisits: 2, invalidVisits: 1 };
const root = { validVisits: 0, invalidVisits: 1 };
const empty = { validVisits: 0, invalidVisits: 0 };
const summary: DomainSummary = {
	version: 1,
	scope: { kind: 'domain', domain },
	period: {
		from: '2026-03-15T12:00:00.000Z',
		asOf: '2026-06-15T12:00:00.000Z',
		timezone: 'UTC',
		retentionMonths: 3
	},
	totals: { validVisits: 3, invalidVisits: 3 },
	base: root,
	links: [
		{ path: '/docs', totals: docs },
		{ path: '/', totals: root },
		{ path: '/a%2Fb', totals: empty }
	]
};

test('reads only domain-wide traffic and links to dedicated path routes', async () => {
	vi.mocked(readVisitSummary).mockResolvedValue(summary);
	const data = await load(request());
	if (!data) throw new Error('Missing page data');
	expect(readVisitSummary).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
		kind: 'domain',
		domain
	});
	expect(data.totals).toEqual(summary.totals);
	expect(data.invalidClicks).toBe(2);
	expect(data.linkCount).toBe(3);
	expect(data.retentionMonths).toBe(3);
	expect(data.links).toMatchObject([
		{ href: '/admin/domains/go.example.test/links/docs', counts: docs },
		{ href: '/admin/domains/go.example.test/links/a/b' },
		{ href: '/admin/domains/go.example.test/links/a%252Fb', counts: empty, state: 'Disabled' }
	]);
	expect(data.base.href).toBe('/admin/domains/go.example.test/links');
	expect(data.base.url).toBeNull();
	expect(data.base.state).toBe('Fallback');
	expect(data.base.counts).toEqual(root);
	expect(data.asOf).toBe(Date.parse(summary.period.asOf));
});

test('shows an active base destination without reclassifying historical outcomes', async () => {
	vi.mocked(readVisitSummary).mockResolvedValue(summary);
	const data = await load(request(domain, 'https://example.test/start'));
	if (!data) throw new Error('Missing base page data');
	expect(data.base.url).toBe('https://example.test/start');
	expect(data.base.state).toBe('Active');
	expect(data.base.counts).toEqual(root);
});

test('excludes invalid base traffic without subtracting valid base redirects', async () => {
	const mixedRoot = { validVisits: 3, invalidVisits: 2 };
	const mixedSummary: DomainSummary = {
		...summary,
		totals: { validVisits: 6, invalidVisits: 4 },
		base: mixedRoot,
		links: summary.links.map((row) => (row.path === '/' ? { ...row, totals: mixedRoot } : row))
	};
	vi.mocked(readVisitSummary).mockResolvedValue(mixedSummary);
	const data = await load(request());
	if (!data) throw new Error('Missing domain page data');
	expect(data.invalidClicks).toBe(2);
	expect(data.totals?.validVisits).toBe(6);
});

test('rejects unknown domains before reading and preserves unavailable rather than zero', async () => {
	await expect(load(request('unknown.test'))).rejects.toMatchObject({ status: 404 });
	expect(readVisitSummary).not.toHaveBeenCalled();
	vi.mocked(readVisitSummary).mockResolvedValue(null);
	const data = await load(request());
	if (!data) throw new Error('Missing unavailable page');
	expect(data.available).toBe(false);
	expect(data.totals).toBeNull();
	expect(data.invalidClicks).toBeNull();
	expect(data.links[0]?.counts).toBeNull();
});
