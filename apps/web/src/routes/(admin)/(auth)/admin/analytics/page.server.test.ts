import { createVisitPeriod } from '@goto/analytics';
import { loadConfig } from '@goto/config';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readVisitDetails } from '#lib/server/visits/reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visits/reports.js', () => ({ readVisitDetails: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const configuredDomain = 'go.example.test';

function request(retentionMonths: 0 | 3, query = '') {
	const prepared = loadConfig(
		{
			auth: { credentials: { username: 'test', password: 'analytics-test-password' } },
			analytics: { retention_months: retentionMonths },
			domains: {
				[configuredDomain]: {
					links: {
						'/a%2Fb': { url: 'https://example.test/literal' },
						'/a/b': { title: 'Nested docs', url: 'https://example.test/nested' }
					}
				},
				'other.example.test': { links: { '/other': { url: 'https://example.test/other' } } }
			}
		},
		{ env: {} }
	);
	return {
		locals: { snapshot: prepareSnapshot(prepared) },
		url: new URL(`https://admin.example.test/admin/analytics${query}`)
	} as Parameters<typeof load>[0];
}

test('redirects to Health without reading a report when analytics is disabled', async () => {
	await expect(load(request(0))).rejects.toMatchObject({ status: 307, location: '/admin/health' });
	expect(readVisitDetails).not.toHaveBeenCalled();
});

test('does not redirect when the global report is unavailable', async () => {
	vi.mocked(readVisitDetails).mockResolvedValueOnce(null);
	const unavailable = await load(request(3));
	expect(readVisitDetails).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
		kind: 'overview'
	});
	expect(unavailable).toMatchObject({ retentionMonths: 3, report: null });
});

test('reads one report for the selected configured domain', async () => {
	vi.mocked(readVisitDetails).mockResolvedValueOnce(null);
	const data = await load(request(3, `?domain=${configuredDomain}`));
	expect(readVisitDetails).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
		kind: 'domain',
		domain: configuredDomain
	});
	expect(data).toMatchObject({ domain: configuredDomain, domainUnavailable: false, path: null });
	expect(data.redirectPaths).toEqual(['/', '/a%2Fb', '/a/b']);
});

test.each(['/', '/a%2Fb', '/a/b'])('reads one report for the exact redirect %s', async (path) => {
	vi.mocked(readVisitDetails).mockResolvedValueOnce(null);
	const query = new URLSearchParams({ domain: configuredDomain, path });
	const data = await load(request(3, `?${query}`));

	expect(readVisitDetails).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
		kind: 'link',
		domain: configuredDomain,
		path
	});
	expect(data).toMatchObject({ path, redirectUnavailable: false });
});

test.each([
	'?path=%2F',
	`?domain=${configuredDomain}&path=`,
	`?domain=${configuredDomain}&path=%2Fa%2F..%2Fb`,
	`?domain=${configuredDomain}&path=%2F&path=%2Fa%2Fb`
])('rejects an invalid redirect query without reading a report: %s', async (query) => {
	await expect(load(request(3, query))).rejects.toMatchObject({ status: 400 });
	expect(readVisitDetails).not.toHaveBeenCalled();
});

test('does not read a broader report for a redirect missing from the selected domain', async () => {
	const data = await load(request(3, `?domain=${configuredDomain}&path=%2Fother`));
	expect(data).toMatchObject({
		domain: configuredDomain,
		path: '/other',
		redirectUnavailable: true,
		report: null
	});
	expect(readVisitDetails).not.toHaveBeenCalled();
});

test.each([`?domain=${configuredDomain}&domain=tiny.example.test`, '?domain=GO.EXAMPLE.TEST'])(
	'rejects an invalid domain query without reading a report: %s',
	async (query) => {
		await expect(load(request(3, query))).rejects.toMatchObject({ status: 400 });
		expect(readVisitDetails).not.toHaveBeenCalled();
	}
);

test('keeps a removed domain selection without falling back to the global report', async () => {
	const data = await load(request(3, '?domain=removed.example.test'));
	expect(data).toMatchObject({
		domain: 'removed.example.test',
		domains: [configuredDomain, 'other.example.test'],
		domainUnavailable: true,
		report: null
	});
	expect(readVisitDetails).not.toHaveBeenCalled();
});

test('projects global totals and keeps each breakdown tied to the selected window', async () => {
	const period = createVisitPeriod(3, Date.parse('2026-06-15T12:00:00.000Z'));
	const recent = { day: '2026-06-01', validVisits: 3, invalidVisits: 1 };
	const older = { day: '2026-05-01', validVisits: 2, invalidVisits: 4 };
	vi.mocked(readVisitDetails).mockResolvedValueOnce({
		version: 5,
		scope: { kind: 'overview' },
		period,
		lastActivityAt: '2026-06-01T12:00:00.000Z',
		daily: [
			{
				start: '2026-05-01T00:00:00.000Z',
				end: '2026-05-02T00:00:00.000Z',
				partial: false,
				validVisits: older.validVisits,
				invalidVisits: older.invalidVisits
			},
			{
				start: '2026-06-01T00:00:00.000Z',
				end: '2026-06-02T00:00:00.000Z',
				partial: false,
				validVisits: recent.validVisits,
				invalidVisits: recent.invalidVisits
			}
		],
		browsers: [
			{ ...older, name: 'Chrome' },
			{ ...recent, name: 'Firefox' }
		],
		operatingSystems: [
			{ ...older, name: 'Windows' },
			{ ...recent, name: 'Linux' }
		],
		acceptedLanguages: [
			{ ...older, name: 'fr' },
			{ ...recent, name: 'en' }
		]
	});

	const { report } = await load(request(3));

	expect(report?.countsByTimeframe).toEqual({
		'7d': { validVisits: 0, invalidVisits: 0 },
		'30d': { validVisits: 3, invalidVisits: 1 },
		all: { validVisits: 5, invalidVisits: 5 }
	});
	expect(report?.browserVisitsByTimeframe['30d']).toEqual([{ name: 'Firefox', visits: 3 }]);
	expect(report?.operatingSystemVisitsByTimeframe['30d']).toEqual([{ name: 'Linux', visits: 3 }]);
	expect(report?.acceptedLanguageVisitsByTimeframe['30d']).toEqual([{ name: 'en', visits: 3 }]);
});
