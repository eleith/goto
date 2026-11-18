import { createVisitPeriod, visitDays, type VisitDetails } from '@goto/analytics';
import { loadConfig } from '@goto/config';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Application } from '#lib/server/application.js';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readLinkDetails } from '#lib/server/visits/reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visits/reports.js', () => ({ readLinkDetails: vi.fn() }));
beforeEach(() => {
	vi.resetAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-06-15T13:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

const tag = 'Work/100%é';
const firstDomain = 'go.example.test';
const secondDomain = 'tiny.example.test';
const period = createVisitPeriod(3, Date.parse('2026-06-15T12:00:00.000Z'));
const domains = {
	[firstDomain]: {
		root: { url: 'https://example.test/start' },
		links: {
			'/docs': { url: 'https://example.test/docs', tags: [tag, tag, 'work'] },
			'/a%2Fb': { url: 'https://example.test/percent', tags: ['%2F'], enabled: false }
		}
	},
	[secondDomain]: {
		links: {
			'/docs': { url: 'https://example.test/other', tags: [tag], enabled: false },
			'/other': { url: 'https://example.test/unrelated', tags: [] }
		}
	}
};

function request(
	selectedTag = tag,
	settings: {
		retentionMonths?: number;
		domains?: Record<string, unknown>;
		visits?: Record<string, Record<string, number>>;
	} = {}
) {
	const prepared = loadConfig(
		{
			auth: { credentials: { username: 'test', password: 'tag-page-test-password' } },
			analytics: { retention_months: settings.retentionMonths ?? 3 },
			domains: settings.domains ?? domains
		},
		{ env: {} }
	);
	const snapshot = prepareSnapshot(prepared);
	const linkVisitCount = vi.fn(
		(domain: string, path: string): number => settings.visits?.[domain]?.[path] ?? 0
	);
	const application: Application = { currentSnapshot: () => snapshot, linkVisitCount };
	return {
		locals: { snapshot, application },
		params: { tag: selectedTag }
	} as Parameters<typeof load>[0];
}

function details(
	domain: string,
	path: string,
	counts: Record<string, [number, number]>,
	browser: string
): VisitDetails {
	const daily = visitDays(period).map((day) => {
		const [validVisits, invalidVisits] = counts[day.start.slice(0, 10)] ?? [0, 0];
		return { ...day, validVisits, invalidVisits };
	});
	const browsers = daily
		.filter(({ validVisits, invalidVisits }) => validVisits > 0 || invalidVisits > 0)
		.map(({ start, validVisits, invalidVisits }) => ({
			day: start.slice(0, 10),
			name: browser,
			validVisits,
			invalidVisits
		}));
	const lastDay = Object.keys(counts).sort().at(-1);
	return {
		version: 5,
		lastActivityAt: lastDay ? `${lastDay}T10:00:00.000Z` : null,
		scope: { kind: 'link', domain, path },
		period,
		daily,
		browsers,
		operatingSystems: browsers.map((row) => ({ ...row, name: 'Other' })),
		acceptedLanguages: browsers.flatMap((row) => [
			{ ...row, name: 'en' },
			{ ...row, name: 'fr' }
		])
	};
}

const firstDetails = details(
	firstDomain,
	'/docs',
	{
		'2026-05-20': [2, 1],
		'2026-06-15': [3, 2]
	},
	'Firefox'
);
const secondDetails = details(
	secondDomain,
	'/docs',
	{
		'2026-03-15': [5, 3],
		'2026-06-09': [4, 1]
	},
	'Chrome'
);
const report = {
	period,
	links: [
		{ domain: firstDomain, path: '/docs', details: firstDetails },
		{ domain: secondDomain, path: '/docs', details: secondDetails }
	]
};

test('projects complete tag traffic and globally distinct member rows without leaking member series', async () => {
	vi.mocked(readLinkDetails).mockResolvedValue(report);
	const data = await load(request());
	expect(readLinkDetails).toHaveBeenCalledExactlyOnceWith(expect.any(Object), [
		{ domain: firstDomain, path: '/docs' },
		{ domain: secondDomain, path: '/docs' }
	]);
	expect(data).toEqual({
		tag,
		retentionMonths: 3,
		collectionEnabled: true,
		available: true,
		lastActivityAt: Date.parse(firstDetails.lastActivityAt!),
		linkCount: 2,
		timeframes: ['7d', '30d', 'all'],
		countsByTimeframe: {
			'7d': { validVisits: 7, invalidVisits: 3 },
			'30d': { validVisits: 9, invalidVisits: 4 },
			all: { validVisits: 14, invalidVisits: 7 }
		},
		acceptedLanguageVisitsByTimeframe: {
			'7d': [
				{ name: 'en', visits: 7 },
				{ name: 'fr', visits: 7 }
			],
			'30d': [
				{ name: 'en', visits: 9 },
				{ name: 'fr', visits: 9 }
			],
			all: [
				{ name: 'en', visits: 14 },
				{ name: 'fr', visits: 14 }
			]
		},
		browserVisitsByTimeframe: {
			'7d': [
				{ name: 'Chrome', visits: 4 },
				{ name: 'Firefox', visits: 3 }
			],
			'30d': [
				{ name: 'Firefox', visits: 5 },
				{ name: 'Chrome', visits: 4 }
			],
			all: [
				{ name: 'Chrome', visits: 9 },
				{ name: 'Firefox', visits: 5 }
			]
		},
		operatingSystemVisitsByTimeframe: {
			'7d': [{ name: 'Other', visits: 7 }],
			'30d': [{ name: 'Other', visits: 9 }],
			all: [{ name: 'Other', visits: 14 }]
		},
		chart: { period, daily: expect.any(Array) },
		links: [
			{
				domain: firstDomain,
				path: '/docs',
				state: 'active',
				countsByTimeframe: {
					'7d': { validVisits: 3, invalidVisits: 2 },
					'30d': { validVisits: 5, invalidVisits: 3 },
					all: { validVisits: 5, invalidVisits: 3 }
				},
				href: '/admin/domains/go.example.test/links/docs'
			},
			{
				domain: secondDomain,
				path: '/docs',
				state: 'disabled',
				countsByTimeframe: {
					'7d': { validVisits: 4, invalidVisits: 1 },
					'30d': { validVisits: 4, invalidVisits: 1 },
					all: { validVisits: 9, invalidVisits: 4 }
				},
				href: '/admin/domains/tiny.example.test/links/docs'
			}
		]
	});
	expect(data.chart?.daily).toHaveLength(visitDays(period).length);
	expect(data.chart?.daily.at(-1)).toMatchObject({
		validVisits: 3,
		invalidVisits: 2,
		partial: true
	});
});

test('current membership reassigns unchanged prepared history without tag-specific reports', async () => {
	vi.mocked(readLinkDetails).mockResolvedValue({ period, links: [report.links[1]!] });
	const data = await load(
		request(tag, {
			domains: {
				[firstDomain]: {
					links: { '/docs': { url: 'https://example.test/docs', tags: ['Different'] } }
				},
				[secondDomain]: domains[secondDomain]
			}
		})
	);
	expect(readLinkDetails).toHaveBeenCalledExactlyOnceWith(expect.any(Object), [
		{ domain: secondDomain, path: '/docs' }
	]);
	expect(data.linkCount).toBe(1);
	expect(data.lastActivityAt).toBe(Date.parse(secondDetails.lastActivityAt!));
	expect(data.countsByTimeframe.all).toEqual({ validVisits: 9, invalidVisits: 4 });
	expect(data.links.map(({ domain, path }) => ({ domain, path }))).toEqual([
		{ domain: secondDomain, path: '/docs' }
	]);
});

test('uses the already decoded literal parameter without decoding percent escapes again', async () => {
	const percentDetails = details(firstDomain, '/a%2Fb', {}, 'Other');
	vi.mocked(readLinkDetails).mockResolvedValue({
		period,
		links: [{ domain: firstDomain, path: '/a%2Fb', details: percentDetails }]
	});
	const event = request('%2F');
	const data = await load(event);
	expect(event.locals.application.linkVisitCount).toHaveBeenCalledExactlyOnceWith(
		firstDomain,
		'/a%2Fb'
	);
	expect(data.tag).toBe('%2F');
	expect(data.lastActivityAt).toBeNull();
	expect(data.countsByTimeframe.all).toEqual({ validVisits: 0, invalidVisits: 0 });
	expect(data.acceptedLanguageVisitsByTimeframe).toEqual({ '7d': [], '30d': [], all: [] });
	expect(data.links[0]?.href).toBe('/admin/domains/go.example.test/links/a%252Fb');
});

test('unknown literal labels return 404 before reading reports', async () => {
	await expect(load(request('work/100%é'))).rejects.toMatchObject({ status: 404 });
	expect(readLinkDetails).not.toHaveBeenCalled();
});

test('unavailable reports preserve all current members but expose no partial traffic', async () => {
	vi.mocked(readLinkDetails).mockResolvedValue(null);
	const data = await load(request());
	expect(data.available).toBe(false);
	expect(data.lastActivityAt).toBeNull();
	expect(data.countsByTimeframe).toEqual({});
	expect(data.acceptedLanguageVisitsByTimeframe).toEqual({});
	expect(data.browserVisitsByTimeframe).toEqual({});
	expect(data.operatingSystemVisitsByTimeframe).toEqual({});
	expect(data.chart).toBeNull();
	expect(data.linkCount).toBe(2);
	expect(data.links.map(({ countsByTimeframe }) => countsByTimeframe)).toEqual([{}, {}]);
	expect(data.links.map(({ href }) => href)).toEqual([
		'/admin/domains/go.example.test/links/docs',
		'/admin/domains/tiny.example.test/links/docs'
	]);
});

test.each([0, 3])(
	'tag rows use domain-specific live counts with %i-month analytics',
	async (retentionMonths) => {
		vi.mocked(readLinkDetails).mockResolvedValue(report);
		const event = request(tag, {
			retentionMonths,
			domains: {
				[firstDomain]: {
					links: { '/docs': { url: 'https://example.test/docs', tags: [tag], max_visits: 100 } }
				},
				[secondDomain]: {
					links: { '/docs': { url: 'https://example.test/other', tags: [tag], max_visits: 100 } }
				}
			},
			visits: { [firstDomain]: { '/docs': 100 }, [secondDomain]: { '/docs': 3 } }
		});
		const data = await load(event);
		expect(data.links.map(({ domain, path, state }) => ({ domain, path, state }))).toEqual([
			{ domain: firstDomain, path: '/docs', state: 'exhausted' },
			{ domain: secondDomain, path: '/docs', state: 'active' }
		]);
		expect(event.locals.application.linkVisitCount).toHaveBeenCalledTimes(2);
		expect(event.locals.application.linkVisitCount).toHaveBeenNthCalledWith(
			1,
			firstDomain,
			'/docs'
		);
		expect(event.locals.application.linkVisitCount).toHaveBeenNthCalledWith(
			2,
			secondDomain,
			'/docs'
		);
	}
);

test('zero retention skips the report reader and keeps tag inventory without traffic controls', async () => {
	const data = await load(request(tag, { retentionMonths: 0 }));
	expect(readLinkDetails).not.toHaveBeenCalled();
	expect(data.collectionEnabled).toBe(false);
	expect(data.available).toBe(false);
	expect(data.lastActivityAt).toBeNull();
	expect(data.timeframes).toEqual([]);
	expect(data.countsByTimeframe).toEqual({});
	expect(data.acceptedLanguageVisitsByTimeframe).toEqual({});
	expect(data.browserVisitsByTimeframe).toEqual({});
	expect(data.operatingSystemVisitsByTimeframe).toEqual({});
	expect(data.chart).toBeNull();
	expect(data.linkCount).toBe(2);
	expect(data.links.map(({ countsByTimeframe }) => countsByTimeframe)).toEqual([{}, {}]);
});
