import { loadConfig } from '@goto/config';
import {
	createVisitPeriod,
	visitDays,
	type ReportPeriod,
	type ReportScope,
	type VisitDetails
} from '@goto/analytics';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readOverviewDetails } from '#lib/server/visits/reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visits/reports.js', () => ({ readOverviewDetails: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const domain = 'go.example.test';
const emptyDomain = 'empty.example.test';
const newDomain = 'new.example.test';

function request(retention_months = 3) {
	const prepared = loadConfig(
		{
			auth: { credentials: { username: 'test', password: 'overview-test-password' } },
			analytics: { retention_months },
			domains: {
				[domain]: {
					links: {
						'/docs': { url: 'https://example.test/docs' },
						'/disabled': { url: 'https://example.test/disabled', enabled: false }
					}
				},
				[emptyDomain]: { root: { url: 'https://example.test/' }, links: {} },
				[newDomain]: { links: { '/new': { url: 'https://example.test/new' } } }
			}
		},
		{ env: {} }
	);
	return { locals: { snapshot: prepareSnapshot(prepared) } } as Parameters<typeof load>[0];
}

function details(
	scope: ReportScope,
	period: ReportPeriod,
	validVisits: (day: string) => number
): VisitDetails {
	const daily = visitDays(period).map((day) => ({
		...day,
		validVisits: validVisits(day.start.slice(0, 10)),
		invalidVisits: 1
	}));
	const browserOsCounts = daily
		.filter(({ validVisits, invalidVisits }) => validVisits > 0 || invalidVisits > 0)
		.map(({ start, validVisits, invalidVisits }) => ({
			day: start.slice(0, 10),
			name: 'Other',
			validVisits,
			invalidVisits
		}));
	return {
		version: 4,
		scope,
		period,
		daily,
		browsers: browserOsCounts,
		operatingSystems: browserOsCounts,
		acceptedLanguages: browserOsCounts.flatMap((row) => [
			{ ...row, name: 'en' },
			{ ...row, name: 'fr' }
		])
	};
}

test('projects compact global window counts while inventory stays current and history stays retained', async () => {
	const period = createVisitPeriod(3, Date.parse('2026-06-15T12:00:00.000Z'));
	const overviewCounts: Record<string, number> = {
		'2026-03-15': 13,
		'2026-04-01': 11,
		'2026-05-16': 7,
		'2026-05-17': 5,
		'2026-06-08': 3,
		'2026-06-09': 2,
		'2026-06-15': 1
	};
	const domainCounts: Record<string, number> = {
		'2026-03-15': 4,
		'2026-05-16': 3,
		'2026-05-17': 2,
		'2026-06-08': 1,
		'2026-06-09': 1,
		'2026-06-15': 1
	};
	const overview = details({ kind: 'overview' }, period, (day) => overviewCounts[day] ?? 0);
	const current = details({ kind: 'domain', domain }, period, (day) => domainCounts[day] ?? 0);
	const empty = details({ kind: 'domain', domain: emptyDomain }, period, () => 0);
	vi.mocked(readOverviewDetails).mockResolvedValue({
		overview,
		domains: [
			{ domain, details: current },
			{ domain: emptyDomain, details: empty }
		]
	});
	const data = await load(request());
	expect(readOverviewDetails).toHaveBeenCalledExactlyOnceWith(expect.any(Object), [
		domain,
		emptyDomain,
		newDomain
	]);
	expect(data).toEqual({
		collectionEnabled: true,
		available: true,
		retentionMonths: 3,
		asOf: Date.parse(period.asOf),
		domainCount: 3,
		linkCount: 3,
		timeframes: ['7d', '30d', 'all'],
		countsByTimeframe: {
			'7d': { validVisits: 3, invalidVisits: 7 },
			'30d': { validVisits: 11, invalidVisits: 30 },
			all: { validVisits: 42, invalidVisits: 93 }
		},
		browserVisitsByTimeframe: {
			'7d': [{ name: 'Other', visits: 3 }],
			'30d': [{ name: 'Other', visits: 11 }],
			all: [{ name: 'Other', visits: 42 }]
		},
		operatingSystemVisitsByTimeframe: {
			'7d': [{ name: 'Other', visits: 3 }],
			'30d': [{ name: 'Other', visits: 11 }],
			all: [{ name: 'Other', visits: 42 }]
		},
		acceptedLanguageVisitsByTimeframe: {
			'7d': [
				{ name: 'en', visits: 3 },
				{ name: 'fr', visits: 3 }
			],
			'30d': [
				{ name: 'en', visits: 11 },
				{ name: 'fr', visits: 11 }
			],
			all: [
				{ name: 'en', visits: 42 },
				{ name: 'fr', visits: 42 }
			]
		},
		chart: { daily: overview.daily, period },
		domains: [
			{
				domain,
				linkCount: 2,
				countsByTimeframe: {
					'7d': { validVisits: 2, invalidVisits: 7 },
					'30d': { validVisits: 5, invalidVisits: 30 },
					all: { validVisits: 12, invalidVisits: 93 }
				},
				href: '/admin/domains/go.example.test'
			},
			{
				domain: emptyDomain,
				linkCount: 0,
				countsByTimeframe: {
					'7d': { validVisits: 0, invalidVisits: 7 },
					'30d': { validVisits: 0, invalidVisits: 30 },
					all: { validVisits: 0, invalidVisits: 93 }
				},
				href: '/admin/domains/empty.example.test'
			},
			{
				domain: newDomain,
				linkCount: 1,
				countsByTimeframe: {},
				href: '/admin/domains/new.example.test'
			}
		]
	});
});

test.each([
	{ months: 9 as const, retainedDays: 273 },
	{ months: 12 as const, retainedDays: 365 }
])(
	'offers four windows for $months months anchored to the latest included day',
	async ({ months, retainedDays }) => {
		const period = createVisitPeriod(months, Date.parse('2026-03-01T00:00:00.000Z'));
		const overview = details({ kind: 'overview' }, period, () => 1);
		vi.mocked(readOverviewDetails).mockResolvedValue({ overview, domains: [] });
		const data = await load(request(months));
		if (!data) throw new Error('Missing overview page');
		expect(data.timeframes).toEqual(['7d', '30d', '90d', 'all']);
		expect(data.countsByTimeframe).toEqual({
			'7d': { validVisits: 7, invalidVisits: 7 },
			'30d': { validVisits: 30, invalidVisits: 30 },
			'90d': { validVisits: 90, invalidVisits: 90 },
			all: { validVisits: retainedDays, invalidVisits: retainedDays }
		});
		expect(data.domains.every((row) => Object.keys(row.countsByTimeframe).length === 0)).toBe(true);
	}
);

test('missing preparation keeps inventory usable without substituting zero counts', async () => {
	vi.mocked(readOverviewDetails).mockResolvedValue(null);
	const data = await load(request());
	if (!data) throw new Error('Missing unavailable page');
	expect(data.available).toBe(false);
	expect(data.collectionEnabled).toBe(true);
	expect(data.retentionMonths).toBe(3);
	expect(data.domainCount).toBe(3);
	expect(data.linkCount).toBe(3);
	expect(data.asOf).toBeNull();
	expect(data.browserVisitsByTimeframe).toEqual({});
	expect(data.operatingSystemVisitsByTimeframe).toEqual({});
	expect(data.chart).toBeNull();
	expect(data.countsByTimeframe).toEqual({});
	expect(data.acceptedLanguageVisitsByTimeframe).toEqual({});
	expect(data.domains.map((row) => row.countsByTimeframe)).toEqual([{}, {}, {}]);
});

test('disabled collection reads no analytics and exposes only inventory with empty counts', async () => {
	const data = await load(request(0));
	if (!data) throw new Error('Missing disabled page');
	expect(data.collectionEnabled).toBe(false);
	expect(data.available).toBe(false);
	expect(data.domainCount).toBe(3);
	expect(data.linkCount).toBe(3);
	expect(data.browserVisitsByTimeframe).toEqual({});
	expect(data.operatingSystemVisitsByTimeframe).toEqual({});
	expect(data.timeframes).toEqual([]);
	expect(data.countsByTimeframe).toEqual({});
	expect(data.acceptedLanguageVisitsByTimeframe).toEqual({});
	expect(data.chart).toBeNull();
	expect(data.domains.map((row) => row.countsByTimeframe)).toEqual([{}, {}, {}]);
	expect(readOverviewDetails).not.toHaveBeenCalled();
});
