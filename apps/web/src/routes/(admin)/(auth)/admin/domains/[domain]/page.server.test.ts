import { validateConfig } from '@goto/config';
import { createVisitPeriod, visitDays, type ReportScope, type VisitDetails } from '@goto/analytics';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readDomainDetails } from '#lib/server/visit-reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visit-reports.js', () => ({ readDomainDetails: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const domain = 'go.example.test';
const period = createVisitPeriod(3, Date.parse('2026-06-15T12:00:00.000Z'));

function request(host = domain, rootUrl?: string, retentionMonths = 3) {
	const links: Record<string, { url: string; enabled?: boolean }> = {
		'/docs': { url: 'https://example.test/docs' },
		'/a/b': { url: 'https://example.test/nested' },
		'/a%2Fb': { url: 'https://example.test/percent', enabled: false }
	};
	if (rootUrl) links['/'] = { url: rootUrl };
	const prepared = validateConfig(
		{
			auth: { credentials: { username: 'test', password: 'domain-test-password' } },
			analytics: { retention_months: retentionMonths },
			domains: { [domain]: { links } }
		},
		{ env: {} }
	);
	return {
		locals: { snapshot: prepareSnapshot(prepared) },
		params: { domain: host }
	} as Parameters<typeof load>[0];
}

function details(scope: ReportScope, counts: Record<string, [number, number]>): VisitDetails {
	const daily = visitDays(period).map((day) => {
		const [validVisits, invalidVisits] = counts[day.start.slice(0, 10)] ?? [0, 0];
		return { ...day, validVisits, invalidVisits };
	});
	const totals = {
		validVisits: daily.reduce((sum, day) => sum + day.validVisits, 0),
		invalidVisits: daily.reduce((sum, day) => sum + day.invalidVisits, 0)
	};
	return {
		version: 1,
		scope,
		period,
		daily,
		browsers: [{ family: 'Other', ...totals }],
		operatingSystems: [{ family: 'Other', ...totals }]
	};
}

const domainDetails = details(
	{ kind: 'domain', domain },
	{
		'2026-03-15': [3, 2],
		'2026-05-16': [5, 4],
		'2026-06-08': [2, 3],
		'2026-06-09': [1, 2],
		'2026-06-15': [4, 3]
	}
);
const baseDetails = details(
	{ kind: 'link', domain, path: '/' },
	{
		'2026-03-15': [3, 1],
		'2026-06-08': [0, 1],
		'2026-06-09': [0, 1],
		'2026-06-15': [0, 1]
	}
);
const docsDetails = details(
	{ kind: 'link', domain, path: '/docs' },
	{
		'2026-05-16': [5, 1],
		'2026-06-09': [1, 0],
		'2026-06-15': [2, 0]
	}
);
const emptyDetails = details({ kind: 'link', domain, path: '/a%2Fb' }, {});
const report = {
	domain: domainDetails,
	links: [
		{ path: '/', details: baseDetails },
		{ path: '/docs', details: docsDetails },
		{ path: '/a%2Fb', details: emptyDetails }
	]
};
const baseCounts = {
	'7d': { validVisits: 0, invalidVisits: 2 },
	'30d': { validVisits: 0, invalidVisits: 3 },
	all: { validVisits: 3, invalidVisits: 4 }
};

test('projects consistent domain, base and link windows without exposing link series or families', async () => {
	vi.mocked(readDomainDetails).mockResolvedValue(report);
	const data = await load(request());
	expect(readDomainDetails).toHaveBeenCalledExactlyOnceWith(expect.any(Object), domain, [
		'/docs',
		'/a/b',
		'/a%2Fb'
	]);
	expect(data).toEqual({
		domain,
		retentionMonths: 3,
		collectionEnabled: true,
		available: true,
		asOf: Date.parse(period.asOf),
		linkCount: 3,
		timeframes: ['7d', '30d', 'all'],
		countsByTimeframe: {
			'7d': { validVisits: 5, invalidVisits: 5 },
			'30d': { validVisits: 7, invalidVisits: 8 },
			all: { validVisits: 15, invalidVisits: 14 }
		},
		invalidClicksByTimeframe: { '7d': 3, '30d': 5, all: 10 },
		chart: { daily: domainDetails.daily, period },
		base: {
			url: null,
			state: 'Fallback',
			countsByTimeframe: baseCounts,
			href: '/admin/domains/go.example.test/links'
		},
		links: [
			{
				path: '/docs',
				url: 'https://example.test/docs',
				state: 'Active',
				countsByTimeframe: {
					'7d': { validVisits: 3, invalidVisits: 0 },
					'30d': { validVisits: 3, invalidVisits: 0 },
					all: { validVisits: 8, invalidVisits: 1 }
				},
				href: '/admin/domains/go.example.test/links/docs'
			},
			{
				path: '/a/b',
				url: 'https://example.test/nested',
				state: 'Active',
				countsByTimeframe: {},
				href: '/admin/domains/go.example.test/links/a/b'
			},
			{
				path: '/a%2Fb',
				url: 'https://example.test/percent',
				state: 'Disabled',
				countsByTimeframe: {
					'7d': { validVisits: 0, invalidVisits: 0 },
					'30d': { validVisits: 0, invalidVisits: 0 },
					all: { validVisits: 0, invalidVisits: 0 }
				},
				href: '/admin/domains/go.example.test/links/a%252Fb'
			}
		]
	});
});

test('shows an active root destination without reclassifying retained outcomes or subtracting valid root traffic', async () => {
	vi.mocked(readDomainDetails).mockResolvedValue(report);
	const data = await load(request(domain, 'https://example.test/start'));
	expect(data.base.url).toBe('https://example.test/start');
	expect(data.base.state).toBe('Active');
	expect(data.base.countsByTimeframe).toEqual(baseCounts);
	expect(data.countsByTimeframe.all?.validVisits).toBe(15);
	expect(data.invalidClicksByTimeframe.all).toBe(10);
	expect(data.linkCount).toBe(4);
});

test('missing base details leave base and non-base invalid counts unavailable, not zero', async () => {
	vi.mocked(readDomainDetails).mockResolvedValue({
		domain: domainDetails,
		links: [{ path: '/docs', details: docsDetails }]
	});
	const data = await load(request());
	expect(data.available).toBe(true);
	expect(data.base.countsByTimeframe).toEqual({});
	expect(data.invalidClicksByTimeframe).toEqual({});
	expect(data.countsByTimeframe.all?.validVisits).toBe(15);
});

test('rejects unknown domains before reading and keeps unavailable inventory usable', async () => {
	await expect(load(request('unknown.test'))).rejects.toMatchObject({ status: 404 });
	expect(readDomainDetails).not.toHaveBeenCalled();
	vi.mocked(readDomainDetails).mockResolvedValue(null);
	const data = await load(request());
	expect(data.available).toBe(false);
	expect(data.chart).toBeNull();
	expect(data.countsByTimeframe).toEqual({});
	expect(data.invalidClicksByTimeframe).toEqual({});
	expect(data.links[0]?.countsByTimeframe).toEqual({});
	expect(data.linkCount).toBe(3);
});

test('disabled collection reads no reports and preserves current inventory', async () => {
	const data = await load(request(domain, undefined, 0));
	expect(readDomainDetails).not.toHaveBeenCalled();
	expect(data.collectionEnabled).toBe(false);
	expect(data.timeframes).toEqual([]);
	expect(data.chart).toBeNull();
	expect(data.countsByTimeframe).toEqual({});
	expect(data.invalidClicksByTimeframe).toEqual({});
	expect(data.base.state).toBe('Fallback');
	expect(data.linkCount).toBe(3);
});
