import { validateConfig, type DomainConfiguration, type RedirectResponse } from '@goto/config';
import { createVisitPeriod, visitDays, type VisitDetails } from '@goto/analytics';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readVisitDetails } from '#lib/server/visit-reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visit-reports.js', () => ({ readVisitDetails: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

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
	const prepared = validateConfig(
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
	version: 3,
	period,
	scope: { kind: 'link', domain, path: '/' },
	daily: visitDays(period).map((day, index) => ({
		...day,
		validVisits: index === 0 ? 7 : 0,
		invalidVisits: 0
	})),
	browsers: rootBrowserOsCounts,
	operatingSystems: rootBrowserOsCounts
};

test('supports historical root traffic without a configured root', async () => {
	vi.mocked(readVisitDetails).mockResolvedValue(rootDetails);
	const data = await load(request());
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
	expect(data.countsByTimeframe.all?.validVisits).toBe(7);
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

test('keeps absent root and default or global fallback metadata usable without analytics', async () => {
	const prepared = validateConfig(
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
	expect(root).toMatchObject({
		response: null,
		fallback: null,
		fallbackSource: 'builtin'
	});
	const global = validateConfig(
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
	expect(inherited).toMatchObject({
		response: null,
		fallback,
		fallbackSource: 'global'
	});
	expect(readVisitDetails).not.toHaveBeenCalled();
});

test('rejects unknown domains before reading root traffic', async () => {
	await expect(load(request({ host: 'unknown.test' }))).rejects.toMatchObject({ status: 404 });
	expect(readVisitDetails).not.toHaveBeenCalled();
});
