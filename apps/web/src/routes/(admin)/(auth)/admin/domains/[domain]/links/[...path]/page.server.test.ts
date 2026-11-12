import { validateConfig } from '@goto/config';
import { createVisitPeriod, visitDays, type VisitDetails } from '@goto/analytics';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readVisitDetails } from '#lib/server/visit-reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visit-reports.js', () => ({ readVisitDetails: vi.fn() }));
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
	version: 2,
	scope: { kind: 'link', domain, path: '/docs' },
	period,
	daily: visitDays(period).map((day) => {
		const [validVisits, invalidVisits] = counts[day.start.slice(0, 10)] ?? [0, 0];
		return { ...day, validVisits, invalidVisits };
	}),
	browsers: browserOsCounts,
	operatingSystems: browserOsCounts
};

test('projects only the requested link series and compact window counts and breakdowns', async () => {
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
		domainHref: '/admin/domains/go.example.test',
		url: 'https://example.test/docs',
		fallback: 404,
		state: 'Active',
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

test('keeps decoded nested and literal-percent identities distinct and supports historical root traffic', async () => {
	vi.mocked(readVisitDetails)
		.mockResolvedValueOnce({ ...details, scope: { kind: 'link', domain, path: '/a/b' } })
		.mockResolvedValueOnce({ ...details, scope: { kind: 'link', domain, path: '/a%2Fb' } })
		.mockResolvedValueOnce({ ...details, scope: { kind: 'link', domain, path: '/' } });
	const nested = await load(request('/a/b'));
	const percent = await load(request('/a%2Fb'));
	const root = await load(request('/'));
	expect(nested.path).toBe('/a/b');
	expect(percent.path).toBe('/a%2Fb');
	expect(percent.state).toBe('Disabled');
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
	expect(readVisitDetails).toHaveBeenNthCalledWith(3, expect.any(Object), {
		kind: 'link',
		domain,
		path: '/'
	});
	expect(root.path).toBe('/');
	expect(root.state).toBe('Fallback');
	expect(root.url).toBeNull();
	expect(root.fallback).toBe(404);
	expect(root.countsByTimeframe.all?.validVisits).toBe(15);
});

test('rejects unknown scopes before reading and keeps unavailable counts absent', async () => {
	await expect(load(request('/docs', 'unknown.test'))).rejects.toMatchObject({ status: 404 });
	await expect(load(request('/not-configured'))).rejects.toMatchObject({ status: 404 });
	expect(readVisitDetails).not.toHaveBeenCalled();
	vi.mocked(readVisitDetails).mockResolvedValue(null);
	const data = await load(request());
	expect(data.available).toBe(false);
	expect(data.browserOsVisitsByTimeframe).toEqual({});
	expect(data.chart).toBeNull();
	expect(data.asOf).toBeNull();
	expect(data.countsByTimeframe).toEqual({});
	expect(data.url).toBe('https://example.test/docs');
	expect(data.retentionMonths).toBe(3);
});

test('disabled analytics skips the report read and leaves link details usable', async () => {
	const data = await load(request('/docs', domain, 0));
	expect(readVisitDetails).not.toHaveBeenCalled();
	expect(data.collectionEnabled).toBe(false);
	expect(data.browserOsVisitsByTimeframe).toEqual({});
	expect(data.available).toBe(false);
	expect(data.retentionMonths).toBe(0);
	expect(data.timeframes).toEqual([]);
	expect(data.chart).toBeNull();
	expect(data.countsByTimeframe).toEqual({});
	expect(data.url).toBe('https://example.test/docs');
	expect(data.state).toBe('Active');
});
