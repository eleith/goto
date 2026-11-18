import { loadConfig, type DomainConfiguration, type RedirectResponse } from '@goto/config';
import { createVisitPeriod, visitDays, type VisitDetails } from '@goto/analytics';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readVisitDetails } from '#lib/server/visits/reports.js';
import { readLifetimeVisitTotals } from '#lib/server/visits/totals.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visits/reports.js', () => ({ readVisitDetails: vi.fn() }));
vi.mock('#lib/server/visits/totals.js', () => ({ readLifetimeVisitTotals: vi.fn() }));
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(readLifetimeVisitTotals).mockResolvedValue(null);
});

const domain = 'go.example.test';
const fallback: RedirectResponse = {
	url: 'https://example.test/fallback',
	status_code: 307,
	forward_query: true
};

function request(options: { host?: string; root?: RedirectResponse } = {}) {
	const domainConfiguration: Partial<DomainConfiguration> = {
		fallback,
		link_defaults: { forward_query: true },
		links: {}
	};
	if (options.root) domainConfiguration.root = options.root;
	const prepared = loadConfig(
		{
			auth: { credentials: { username: 'test', password: 'link-test-password' } },
			analytics: { retention_months: 3 },
			link_defaults: { status_code: 301 },
			domains: { [domain]: domainConfiguration }
		},
		{ env: {} }
	);
	return {
		locals: { snapshot: prepareSnapshot(prepared) },
		params: { domain: options.host ?? domain }
	} as Parameters<typeof load>[0];
}

const period = createVisitPeriod(3, Date.parse('2026-06-15T12:00:00.000Z'));
const rootBrowserOsCounts = [
	{ day: period.from.slice(0, 10), name: 'Other', validVisits: 7, invalidVisits: 0 }
];
const rootDetails: VisitDetails = {
	version: 5,
	lastActivityAt: `${period.from.slice(0, 10)}T10:00:00.000Z`,
	period,
	scope: { kind: 'link', domain, path: '/' },
	daily: visitDays(period).map((day, index) => ({
		...day,
		validVisits: index === 0 ? 7 : 0,
		invalidVisits: 0
	})),
	browsers: rootBrowserOsCounts,
	operatingSystems: rootBrowserOsCounts,
	acceptedLanguages: rootBrowserOsCounts.flatMap((row) => [
		{ ...row, name: 'en' },
		{ ...row, name: 'fr' }
	])
};

test('supports historical root traffic without a configured root and preserves unavailable metadata', async () => {
	vi.mocked(readVisitDetails).mockResolvedValue(rootDetails);
	vi.mocked(readLifetimeVisitTotals).mockResolvedValue({ validVisits: 40, invalidVisits: 0 });
	const data = await load(request());
	expect(data.lifetimeVisitTotals).toEqual({ validVisits: 40, invalidVisits: 0 });
	expect(readLifetimeVisitTotals).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
		kind: 'link',
		domain,
		path: '/'
	});
	expect(readVisitDetails).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
		kind: 'link',
		domain,
		path: '/'
	});
	expect(data).toMatchObject({
		domain,
		domainHref: '/admin/domains/go.example.test',
		response: null,
		fallback,
		fallbackSource: 'domain'
	});
	expect(data.lastActivityAt).toBe(Date.parse(rootDetails.lastActivityAt!));
	expect(data.countsByTimeframe.all?.validVisits).toBe(7);
	expect(data.browserVisitsByTimeframe).toEqual({
		'7d': [],
		'30d': [],
		all: [{ name: 'Other', visits: 7 }]
	});
	expect(data.operatingSystemVisitsByTimeframe).toEqual({
		'7d': [],
		'30d': [],
		all: [{ name: 'Other', visits: 7 }]
	});
	expect(data.acceptedLanguageVisitsByTimeframe).toEqual({
		'7d': [],
		'30d': [],
		all: [
			{ name: 'en', visits: 7 },
			{ name: 'fr', visits: 7 }
		]
	});
	vi.mocked(readVisitDetails).mockResolvedValue(null);
	const unavailable = await load(request());
	expect(unavailable.available).toBe(false);
	expect(unavailable.lifetimeVisitTotals).toEqual({ validVisits: 40, invalidVisits: 0 });
	expect(unavailable.chart).toBeNull();
	expect(unavailable.browserVisitsByTimeframe).toEqual({});
	expect(unavailable.operatingSystemVisitsByTimeframe).toEqual({});
	expect(unavailable.acceptedLanguageVisitsByTimeframe).toEqual({});
	expect(unavailable.fallback).toEqual(fallback);
});

test('keeps root HTTP settings independent of link defaults and fallback with historical analytics scope', async () => {
	vi.mocked(readVisitDetails).mockResolvedValue(rootDetails);
	const response: RedirectResponse = {
		url: 'https://example.test/start',
		status_code: 302,
		forward_query: false
	};
	const data = await load(request({ root: response }));
	expect(readVisitDetails).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
		kind: 'link',
		domain,
		path: '/'
	});
	expect(data).toMatchObject({
		response,
		fallback,
		fallbackSource: 'domain'
	});
	expect(data.countsByTimeframe.all).toEqual({ validVisits: 7, invalidVisits: 0 });
});

test('keeps lifetime root visit totals and fallback metadata usable without finite analytics', async () => {
	vi.mocked(readLifetimeVisitTotals).mockResolvedValue({ validVisits: 40, invalidVisits: 0 });
	const prepared = loadConfig(
		{
			auth: { credentials: { username: 'test', password: 'link-test-password' } },
			analytics: { retention_months: 0 },
			domains: { [domain]: { links: {} } }
		},
		{ env: {} }
	);
	const event = {
		locals: { snapshot: prepareSnapshot(prepared) },
		params: { domain }
	} as Parameters<typeof load>[0];
	const root = await load(event);
	expect(root.lifetimeVisitTotals).toEqual({ validVisits: 40, invalidVisits: 0 });
	expect(root.browserVisitsByTimeframe).toEqual({});
	expect(root.operatingSystemVisitsByTimeframe).toEqual({});
	expect(root.acceptedLanguageVisitsByTimeframe).toEqual({});
	expect(root).toMatchObject({
		response: null,
		fallback: null,
		fallbackSource: 'builtin'
	});
	const global = loadConfig(
		{
			auth: { credentials: { username: 'test', password: 'link-test-password' } },
			analytics: { retention_months: 0 },
			fallback,
			domains: { [domain]: { links: {} } }
		},
		{ env: {} }
	);
	event.locals.snapshot = prepareSnapshot(global);
	const inherited = await load(event);
	expect(inherited.lifetimeVisitTotals).toEqual({ validVisits: 40, invalidVisits: 0 });
	expect(vi.mocked(readLifetimeVisitTotals).mock.calls.map(([, scope]) => scope)).toEqual([
		{ kind: 'link', domain, path: '/' },
		{ kind: 'link', domain, path: '/' }
	]);
	expect(inherited.browserVisitsByTimeframe).toEqual({});
	expect(inherited.operatingSystemVisitsByTimeframe).toEqual({});
	expect(inherited.acceptedLanguageVisitsByTimeframe).toEqual({});
	expect(inherited).toMatchObject({
		response: null,
		fallback,
		fallbackSource: 'global'
	});
	expect(readVisitDetails).not.toHaveBeenCalled();
});

test('unavailable lifetime root visit totals do not suppress retained visits', async () => {
	vi.mocked(readVisitDetails).mockResolvedValue(rootDetails);
	const data = await load(request());
	expect(data.lifetimeVisitTotals).toBeNull();
	expect(data.available).toBe(true);
	expect(data.countsByTimeframe.all).toEqual({ validVisits: 7, invalidVisits: 0 });
});

test('rejects unknown domains before reading root traffic', async () => {
	await expect(load(request({ host: 'unknown.test' }))).rejects.toMatchObject({ status: 404 });
	expect(readVisitDetails).not.toHaveBeenCalled();
	expect(readLifetimeVisitTotals).not.toHaveBeenCalled();
});
