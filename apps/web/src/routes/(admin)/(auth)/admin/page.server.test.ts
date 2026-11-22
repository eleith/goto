import { loadConfig } from '@goto/config';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readLastActivity } from '#lib/server/visits/reports.js';
import { readOverviewLifetimeVisitTotals } from '#lib/server/visits/totals.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visits/reports.js', () => ({ readLastActivity: vi.fn() }));
vi.mock('#lib/server/visits/totals.js', () => ({ readOverviewLifetimeVisitTotals: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const domain = 'go.example.test';
const emptyDomain = 'empty.example.test';

function request(retentionMonths: 0 | 3) {
	const snapshot = prepareSnapshot(
		loadConfig(
			{
				auth: { credentials: { username: 'test', password: 'overview-test-password' } },
				analytics: { retention_months: retentionMonths },
				domains: {
					[domain]: {
						links: {
							'/docs': { url: 'https://example.test/docs' },
							'/disabled': { url: 'https://example.test/disabled', enabled: false }
						}
					},
					[emptyDomain]: { root: { url: 'https://example.test/' }, links: {} }
				}
			},
			{ env: {} }
		)
	);
	return { locals: { snapshot } } as Parameters<typeof load>[0];
}

test('shows all-time totals and current inventory even when detailed analytics is disabled', async () => {
	vi.mocked(readOverviewLifetimeVisitTotals).mockResolvedValueOnce({
		overview: { validVisits: 40, invalidVisits: 7 },
		byDomain: new Map([
			[domain, { validVisits: 12, invalidVisits: 2 }],
			[emptyDomain, { validVisits: 0, invalidVisits: 0 }]
		])
	});

	const data = await load(request(0));

	expect(readOverviewLifetimeVisitTotals).toHaveBeenCalledExactlyOnceWith(expect.any(Object), [
		domain,
		emptyDomain
	]);
	expect(readLastActivity).not.toHaveBeenCalled();
	expect(data).toEqual({
		analyticsEnabled: false,
		lastActivityAt: null,
		domainCount: 2,
		linkCount: 2,
		totalVisits: 40,
		domains: [
			{ domain, linkCount: 2, totalVisits: 12, href: '/admin/domains/go.example.test' },
			{
				domain: emptyDomain,
				linkCount: 0,
				totalVisits: 0,
				href: '/admin/domains/empty.example.test'
			}
		]
	});
});

test('keeps the inventory and last activity when stored totals are unavailable', async () => {
	const lastActivityAt = '2026-06-15T12:00:00.000Z';
	vi.mocked(readOverviewLifetimeVisitTotals).mockResolvedValueOnce(null);
	vi.mocked(readLastActivity).mockResolvedValueOnce({ available: true, lastActivityAt });

	const data = await load(request(3));

	expect(data).toMatchObject({
		analyticsEnabled: true,
		totalVisits: null,
		lastActivityAt: Date.parse(lastActivityAt)
	});
	expect(data.domains).toMatchObject([
		{ domain, linkCount: 2, totalVisits: null },
		{ domain: emptyDomain, linkCount: 0, totalVisits: null }
	]);
});
