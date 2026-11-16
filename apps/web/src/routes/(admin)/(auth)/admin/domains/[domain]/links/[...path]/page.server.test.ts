import { loadConfig, type DomainConfiguration } from '@goto/config';
import { createVisitPeriod, visitDays, type VisitDetails } from '@goto/analytics';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readVisitDetails } from '#lib/server/visits/reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visits/reports.js', () => ({ readVisitDetails: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const domain = 'go.example.test';
const linkMetadata = {
	response: { url: 'https://example.test/docs', status_code: 308, forward_query: true },
	redirectRules: [
		{ language: 'fr-ca', os: 'ios', to: 'https://example.test/fr-ios' },
		{ language: null, os: 'linux', to: 'https://example.test/linux' },
		{ language: 'en', os: null, to: 'https://example.test/en' }
	],
	caseInsensitive: false,
	ignoreTrailingSlash: false,
	forwardPath: true,
	state: 'active',
	validFrom: '2000-01-01T00:00:00Z',
	validUntil: '2100-01-01T00:00:00Z',
	tags: ['guides', 'reference']
};

function request(path = '/docs', options: { host?: string; retentionMonths?: number } = {}) {
	const domainConfiguration: Partial<DomainConfiguration> = {
		link_defaults: { forward_query: true, ignore_trailing_slash: false },
		links: {
			'/docs': {
				url: 'https://example.test/docs',
				redirect: [
					{ if: { language: 'FR-ca', os: 'ios' }, to: 'https://example.test/fr-ios' },
					{ if: { os: 'linux' }, to: 'https://example.test/linux' },
					{ if: { language: 'en' }, to: 'https://example.test/en' }
				],
				status_code: 308,
				forward_path: true,
				enabled: true,
				valid_from: '2000-01-01T00:00:00Z',
				valid_until: '2100-01-01T00:00:00Z',
				tags: ['guides', 'reference']
			},
			'/a/b': { url: 'https://example.test/nested', enabled: true, tags: [] },
			'/a%2Fb': {
				url: 'https://example.test/percent',
				redirect: [{ if: { language: 'fr' }, to: 'https://example.test/percent-fr' }],
				enabled: false,
				tags: []
			}
		}
	};
	const prepared = loadConfig(
		{
			auth: { credentials: { username: 'test', password: 'link-test-password' } },
			analytics: { retention_months: options.retentionMonths ?? 3 },
			link_defaults: { status_code: 301, case_insensitive: false },
			domains: { [domain]: domainConfiguration }
		},
		{ env: {} }
	);
	return {
		locals: { snapshot: prepareSnapshot(prepared) },
		params: { domain: options.host ?? domain, path: path.slice(1) }
	} as Parameters<typeof load>[0];
}

const period = createVisitPeriod(3, Date.parse('2026-06-15T12:00:00.000Z'));
const counts: Record<string, [number, number]> = {
	'2026-03-15': [4, 1],
	'2026-05-16': [3, 2],
	'2026-06-08': [5, 1],
	'2026-06-09': [2, 1],
	'2026-06-15': [1, 0]
};
const browserOsCounts = Object.entries(counts).map(([day, [validVisits, invalidVisits]]) => ({
	day,
	name: 'Other',
	validVisits,
	invalidVisits
}));
const details: VisitDetails = {
	version: 4,
	scope: { kind: 'link', domain, path: '/docs' },
	period,
	daily: visitDays(period).map((day) => {
		const [validVisits, invalidVisits] = counts[day.start.slice(0, 10)] ?? [0, 0];
		return { ...day, validVisits, invalidVisits };
	}),
	browsers: browserOsCounts,
	operatingSystems: browserOsCounts,
	acceptedLanguages: browserOsCounts.flatMap((row) => [
		{ ...row, name: 'en' },
		{ ...row, name: 'fr' }
	])
};

test('projects only requested link settings, series and compact window counts and breakdowns', async () => {
	vi.mocked(readVisitDetails).mockResolvedValue(details);
	const data = await load(request());
	expect(readVisitDetails).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
		kind: 'link',
		domain,
		path: '/docs'
	});
	expect(data).toEqual({
		domain,
		path: '/docs',
		...linkMetadata,
		retentionMonths: 3,
		collectionEnabled: true,
		available: true,
		asOf: Date.parse(period.asOf),
		timeframes: ['7d', '30d', 'all'],
		countsByTimeframe: {
			'7d': { validVisits: 3, invalidVisits: 1 },
			'30d': { validVisits: 8, invalidVisits: 2 },
			all: { validVisits: 15, invalidVisits: 5 }
		},
		acceptedLanguageVisitsByTimeframe: {
			'7d': [
				{ name: 'en', visits: 3 },
				{ name: 'fr', visits: 3 }
			],
			'30d': [
				{ name: 'en', visits: 8 },
				{ name: 'fr', visits: 8 }
			],
			all: [
				{ name: 'en', visits: 15 },
				{ name: 'fr', visits: 15 }
			]
		},
		browserOsVisitsByTimeframe: {
			'7d': {
				browsers: [{ name: 'Other', visits: 3 }],
				operatingSystems: [{ name: 'Other', visits: 3 }]
			},
			'30d': {
				browsers: [{ name: 'Other', visits: 8 }],
				operatingSystems: [{ name: 'Other', visits: 8 }]
			},
			all: {
				browsers: [{ name: 'Other', visits: 15 }],
				operatingSystems: [{ name: 'Other', visits: 15 }]
			}
		},
		chart: { daily: details.daily, period }
	});
});

test('keeps decoded nested and literal-percent identities distinct', async () => {
	vi.mocked(readVisitDetails)
		.mockResolvedValueOnce({ ...details, scope: { kind: 'link', domain, path: '/a/b' } })
		.mockResolvedValueOnce({ ...details, scope: { kind: 'link', domain, path: '/a%2Fb' } });
	const nested = await load(request('/a/b'));
	const percent = await load(request('/a%2Fb'));
	expect(nested.path).toBe('/a/b');
	expect(nested).toMatchObject({
		response: { url: 'https://example.test/nested', status_code: 301, forward_query: true },
		redirectRules: [],
		caseInsensitive: false,
		ignoreTrailingSlash: false,
		forwardPath: false,
		state: 'active',
		validFrom: null,
		validUntil: null,
		tags: []
	});
	expect(percent.path).toBe('/a%2Fb');
	expect(percent.state).toBe('disabled');
	expect(percent.redirectRules).toEqual([
		{ language: 'fr', os: null, to: 'https://example.test/percent-fr' }
	]);
	expect(percent.countsByTimeframe.all?.validVisits).toBe(15);
	expect(readVisitDetails).toHaveBeenNthCalledWith(1, expect.any(Object), {
		kind: 'link',
		domain,
		path: '/a/b'
	});
	expect(readVisitDetails).toHaveBeenNthCalledWith(2, expect.any(Object), {
		kind: 'link',
		domain,
		path: '/a%2Fb'
	});
});

test('rejects unknown scopes before reading and keeps unavailable counts absent', async () => {
	await expect(load(request('/docs', { host: 'unknown.test' }))).rejects.toMatchObject({
		status: 404
	});
	await expect(load(request('/not-configured'))).rejects.toMatchObject({ status: 404 });
	await expect(load(request('/'))).rejects.toMatchObject({ status: 404 });
	expect(readVisitDetails).not.toHaveBeenCalled();
	vi.mocked(readVisitDetails).mockResolvedValue(null);
	const data = await load(request());
	expect(data.available).toBe(false);
	expect(data.browserOsVisitsByTimeframe).toEqual({});
	expect(data.chart).toBeNull();
	expect(data.asOf).toBeNull();
	expect(data.countsByTimeframe).toEqual({});
	expect(data.acceptedLanguageVisitsByTimeframe).toEqual({});
	expect(data).toMatchObject(linkMetadata);
	expect(data.retentionMonths).toBe(3);
});

test('disabled analytics skips the report read and leaves link details usable', async () => {
	const data = await load(request('/docs', { retentionMonths: 0 }));
	expect(readVisitDetails).not.toHaveBeenCalled();
	expect(data.collectionEnabled).toBe(false);
	expect(data.browserOsVisitsByTimeframe).toEqual({});
	expect(data.available).toBe(false);
	expect(data.retentionMonths).toBe(0);
	expect(data.timeframes).toEqual([]);
	expect(data.chart).toBeNull();
	expect(data.countsByTimeframe).toEqual({});
	expect(data.acceptedLanguageVisitsByTimeframe).toEqual({});
	expect(data).toMatchObject(linkMetadata);
});
