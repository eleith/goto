import { loadConfig, type DomainConfiguration, type RedirectResponse } from '@goto/config';
import { createVisitPeriod, visitDays, type ReportScope, type VisitDetails } from '@goto/analytics';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Application } from '#lib/server/application.js';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readDomainDetails } from '#lib/server/visits/reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visits/reports.js', () => ({ readDomainDetails: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const domain = 'go.example.test';
const period = createVisitPeriod(3, Date.parse('2026-06-15T12:00:00.000Z'));

function request(
	host = domain,
	settings: {
		root?: RedirectResponse;
		fallback?: RedirectResponse;
		globalFallback?: RedirectResponse;
		retentionMonths?: number;
		links?: Record<string, { url: string; enabled?: boolean; max_visits?: number }>;
		visits?: Record<string, number>;
	} = {}
) {
	const links = settings.links ?? {
		'/docs': { url: 'https://example.test/docs' },
		'/a/b': { url: 'https://example.test/nested' },
		'/a%2Fb': { url: 'https://example.test/percent', enabled: false }
	};
	const domainConfiguration: Pick<DomainConfiguration, 'root' | 'fallback'> & {
		links: typeof links;
	} = { links };
	if (settings.root) domainConfiguration.root = settings.root;
	if (settings.fallback) domainConfiguration.fallback = settings.fallback;
	const configuration: Record<string, unknown> = {
		auth: { credentials: { username: 'test', password: 'domain-test-password' } },
		analytics: { retention_months: settings.retentionMonths ?? 3 },
		domains: { [domain]: domainConfiguration }
	};
	if (settings.globalFallback) configuration.fallback = settings.globalFallback;
	const prepared = loadConfig(configuration, { env: {} });
	const snapshot = prepareSnapshot(prepared);
	const linkVisitCount = vi.fn((host: string, path: string): number => {
		if (host !== domain) throw new Error('Unexpected domain');
		return settings.visits?.[path] ?? 0;
	});
	const application: Application = { currentSnapshot: () => snapshot, linkVisitCount };
	return {
		locals: { snapshot, application },
		params: { domain: host }
	} as Parameters<typeof load>[0];
}

function details(scope: ReportScope, counts: Record<string, [number, number]>): VisitDetails {
	const daily = visitDays(period).map((day) => {
		const [validVisits, invalidVisits] = counts[day.start.slice(0, 10)] ?? [0, 0];
		return { ...day, validVisits, invalidVisits };
	});
	const browserOsCounts = daily
		.filter(({ validVisits, invalidVisits }) => validVisits > 0 || invalidVisits > 0)
		.map(({ start, validVisits, invalidVisits }) => ({
			day: start.slice(0, 10),
			name: 'Other',
			validVisits,
			invalidVisits
		}));
	const lastDay = Object.keys(counts).sort().at(-1);
	return {
		version: 5,
		lastActivityAt: lastDay ? `${lastDay}T10:00:00.000Z` : null,
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

const domainDetails = details(
	{ kind: 'domain', domain },
	{
		'2026-03-15': [4, 1],
		'2026-05-16': [5, 4],
		'2026-06-08': [3, 2],
		'2026-06-09': [2, 1],
		'2026-06-15': [5, 2]
	}
);
const rootDetails = details(
	{ kind: 'link', domain, path: '/' },
	{
		'2026-03-15': [4, 0],
		'2026-06-08': [1, 0],
		'2026-06-09': [1, 0],
		'2026-06-15': [1, 0]
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
		{ path: '/', details: rootDetails },
		{ path: '/docs', details: docsDetails },
		{
			path: '/a/b',
			details: { ...emptyDetails, scope: { kind: 'link' as const, domain, path: '/a/b' } }
		},
		{ path: '/a%2Fb', details: emptyDetails }
	]
};
const rootCounts = {
	'7d': { validVisits: 2, invalidVisits: 0 },
	'30d': { validVisits: 3, invalidVisits: 0 },
	all: { validVisits: 7, invalidVisits: 0 }
};

test('projects compact domain breakdowns without exposing link series or dated named counts', async () => {
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
		lastActivityAt: Date.parse(domainDetails.lastActivityAt!),
		linkCount: 3,
		timeframes: ['7d', '30d', 'all'],
		countsByTimeframe: {
			'7d': { validVisits: 7, invalidVisits: 3 },
			'30d': { validVisits: 10, invalidVisits: 5 },
			all: { validVisits: 19, invalidVisits: 10 }
		},
		acceptedLanguageVisitsByTimeframe: {
			'7d': [
				{ name: 'en', visits: 7 },
				{ name: 'fr', visits: 7 }
			],
			'30d': [
				{ name: 'en', visits: 10 },
				{ name: 'fr', visits: 10 }
			],
			all: [
				{ name: 'en', visits: 19 },
				{ name: 'fr', visits: 19 }
			]
		},
		browserVisitsByTimeframe: {
			'7d': [{ name: 'Other', visits: 7 }],
			'30d': [{ name: 'Other', visits: 10 }],
			all: [{ name: 'Other', visits: 19 }]
		},
		operatingSystemVisitsByTimeframe: {
			'7d': [{ name: 'Other', visits: 7 }],
			'30d': [{ name: 'Other', visits: 10 }],
			all: [{ name: 'Other', visits: 19 }]
		},
		chart: { daily: domainDetails.daily, period },
		root: null,
		fallback: null,
		links: [
			{
				path: '/',
				url: null,
				state: 'active',
				countsByTimeframe: rootCounts,
				href: '/admin/domains/go.example.test/links'
			},
			{
				path: '/docs',
				url: 'https://example.test/docs',
				state: 'active',
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
				state: 'active',
				countsByTimeframe: {
					'7d': { validVisits: 0, invalidVisits: 0 },
					'30d': { validVisits: 0, invalidVisits: 0 },
					all: { validVisits: 0, invalidVisits: 0 }
				},
				href: '/admin/domains/go.example.test/links/a/b'
			},
			{
				path: '/a%2Fb',
				url: 'https://example.test/percent',
				state: 'disabled',
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

test('keeps root and fallback responses separate and includes all normalized root history in valid domain visits', async () => {
	vi.mocked(readDomainDetails).mockResolvedValue(report);
	const root: RedirectResponse = {
		url: 'https://example.test/start',
		status_code: 307,
		forward_query: true
	};
	const fallback: RedirectResponse = {
		url: 'https://example.test/missing',
		status_code: 308,
		forward_query: false
	};
	const data = await load(
		request(domain, {
			root,
			fallback,
			globalFallback: { url: 'https://example.test/global', status_code: 302, forward_query: true }
		})
	);
	expect(data.root).toEqual(root);
	expect(data.fallback).toEqual(fallback);
	expect(data.links[0]).toEqual({
		path: '/',
		url: root.url,
		state: 'active',
		countsByTimeframe: rootCounts,
		href: '/admin/domains/go.example.test/links'
	});
	expect(data.countsByTimeframe.all).toEqual({ validVisits: 19, invalidVisits: 10 });
	expect(data.linkCount).toBe(3);
	expect(data.links.map(({ path }) => path)).toEqual(['/', '/docs', '/a/b', '/a%2Fb']);
});

test('keeps root reachable through the domain fallback with no named links', async () => {
	vi.mocked(readDomainDetails).mockResolvedValue(report);
	const fallback: RedirectResponse = {
		url: 'https://example.test/missing',
		status_code: 302,
		forward_query: false
	};
	const data = await load(request(domain, { fallback, links: {} }));
	expect(readDomainDetails).toHaveBeenCalledExactlyOnceWith(expect.any(Object), domain, []);
	expect(data.root).toBeNull();
	expect(data.fallback).toEqual(fallback);
	expect(data.linkCount).toBe(0);
	expect(data.links).toEqual([
		{
			path: '/',
			url: fallback.url,
			state: 'active',
			countsByTimeframe: rootCounts,
			href: '/admin/domains/go.example.test/links'
		}
	]);
	expect(data.countsByTimeframe.all).toEqual({ validVisits: 19, invalidVisits: 10 });
});

test('empty root history gives zero visits without hiding non-root invalid counts', async () => {
	vi.mocked(readDomainDetails).mockResolvedValue({
		...report,
		links: report.links.map((link) =>
			link.path === '/'
				? {
						path: '/',
						details: { ...emptyDetails, scope: { kind: 'link' as const, domain, path: '/' } }
					}
				: link
		)
	});
	const data = await load(request());
	expect(data.available).toBe(true);
	expect(data.links[0]).toEqual({
		path: '/',
		url: null,
		state: 'active',
		countsByTimeframe: {
			'7d': { validVisits: 0, invalidVisits: 0 },
			'30d': { validVisits: 0, invalidVisits: 0 },
			all: { validVisits: 0, invalidVisits: 0 }
		},
		href: '/admin/domains/go.example.test/links'
	});
	expect(data.countsByTimeframe.all).toEqual({ validVisits: 19, invalidVisits: 10 });
});

test('rejects unknown domains before reading and keeps unavailable inventory usable', async () => {
	await expect(load(request('unknown.test'))).rejects.toMatchObject({ status: 404 });
	expect(readDomainDetails).not.toHaveBeenCalled();
	vi.mocked(readDomainDetails).mockResolvedValue(null);
	const fallback: RedirectResponse = {
		url: 'https://example.test/global',
		status_code: 307,
		forward_query: true
	};
	const data = await load(request(domain, { globalFallback: fallback }));
	expect(data.root).toBeNull();
	expect(data.fallback).toEqual(fallback);
	expect(data.available).toBe(false);
	expect(data.browserVisitsByTimeframe).toEqual({});
	expect(data.operatingSystemVisitsByTimeframe).toEqual({});
	expect(data.chart).toBeNull();
	expect(data.countsByTimeframe).toEqual({});
	expect(data.acceptedLanguageVisitsByTimeframe).toEqual({});
	expect(data.links[0]).toEqual({
		path: '/',
		url: fallback.url,
		state: 'active',
		countsByTimeframe: {},
		href: '/admin/domains/go.example.test/links'
	});
	expect(data.linkCount).toBe(3);
});

test.each([0, 3])(
	'domain rows use canonical live counts with %i-month analytics',
	async (retentionMonths) => {
		vi.mocked(readDomainDetails).mockResolvedValue(report);
		const event = request(domain, {
			retentionMonths,
			links: {
				'/docs': { url: 'https://example.test/docs', enabled: false, max_visits: 2 },
				'/a%2Fb': { url: 'https://example.test/percent', max_visits: 8 }
			},
			visits: { '/docs': 2, '/a%2Fb': 8 }
		});
		const data = await load(event);
		expect(data.links.map(({ path, state, href }) => ({ path, state, href }))).toEqual([
			{ path: '/', state: 'active', href: '/admin/domains/go.example.test/links' },
			{ path: '/docs', state: 'disabled', href: '/admin/domains/go.example.test/links/docs' },
			{ path: '/a%2Fb', state: 'exhausted', href: '/admin/domains/go.example.test/links/a%252Fb' }
		]);
		expect(event.locals.application.linkVisitCount).toHaveBeenCalledTimes(2);
		expect(event.locals.application.linkVisitCount).toHaveBeenNthCalledWith(1, domain, '/docs');
		expect(event.locals.application.linkVisitCount).toHaveBeenNthCalledWith(2, domain, '/a%2Fb');
	}
);

test('disabled analytics preserves current inventory without reports', async () => {
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
	const data = await load(request(domain, { root, fallback, retentionMonths: 0 }));
	expect(readDomainDetails).not.toHaveBeenCalled();
	expect(data.collectionEnabled).toBe(false);
	expect(data.browserVisitsByTimeframe).toEqual({});
	expect(data.operatingSystemVisitsByTimeframe).toEqual({});
	expect(data.timeframes).toEqual([]);
	expect(data.chart).toBeNull();
	expect(data.countsByTimeframe).toEqual({});
	expect(data.acceptedLanguageVisitsByTimeframe).toEqual({});
	expect(data.root).toEqual(root);
	expect(data.fallback).toEqual(fallback);
	expect(data.links[0]).toEqual({
		path: '/',
		url: root.url,
		state: 'active',
		countsByTimeframe: {},
		href: '/admin/domains/go.example.test/links'
	});
	expect(data.linkCount).toBe(3);
});
