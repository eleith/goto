import { validateConfig } from '@goto/config';
import type { OverviewSummary } from '@goto/analytics';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readVisitSummary } from '#lib/server/visit-reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visit-reports.js', () => ({ readVisitSummary: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

function request(retention_months = 3) {
	const prepared = validateConfig(
		{
			auth: { credentials: { username: 'test', password: 'overview-test-password' } },
			analytics: { retention_months },
			domains: {
				'go.example.test': {
					links: {
						'/docs': { url: 'https://example.test/docs' },
						'/disabled': { url: 'https://example.test/disabled', enabled: false }
					}
				}
			}
		},
		{ env: {} }
	);
	return { locals: { snapshot: prepareSnapshot(prepared) } } as Parameters<typeof load>[0];
}

test('shows current configuration and the worker-prepared summary without re-aggregating', async () => {
	const counts = { validVisits: 2, invalidVisits: 2 };
	const summary: OverviewSummary = {
		version: 1,
		scope: { kind: 'overview' },
		period: {
			from: '2026-03-15T12:00:00.000Z',
			asOf: '2026-06-15T12:00:00.000Z',
			timezone: 'UTC',
			retentionMonths: 3
		},
		totals: { validVisits: 7, invalidVisits: 2 },
		base: { validVisits: 0, invalidVisits: 1 },
		domains: [{ domain: 'go.example.test', totals: counts }]
	};
	vi.mocked(readVisitSummary).mockResolvedValue(summary);
	const data = await load(request());
	if (!data) throw new Error('Missing page data');
	expect(readVisitSummary).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
		kind: 'overview'
	});
	expect(data.domainCount).toBe(1);
	expect(data.linkCount).toBe(2);
	expect(data.totals).toEqual(summary.totals);
	expect(data.asOf).toBe(Date.parse(summary.period.asOf));
	expect(data.domains[0]).toMatchObject({
		href: '/admin/domains/go.example.test',
		counts
	});
});

test('disabled collection does not read a report; missing preparation is not zero', async () => {
	const disabled = await load(request(0));
	if (!disabled) throw new Error('Missing disabled page');
	expect(disabled.collectionEnabled).toBe(false);
	expect(disabled.totals).toBeNull();
	expect(readVisitSummary).not.toHaveBeenCalled();
	vi.mocked(readVisitSummary).mockResolvedValue(null);
	const unavailable = await load(request());
	if (!unavailable) throw new Error('Missing unavailable page');
	expect(unavailable.available).toBe(false);
	expect(unavailable.domains[0]?.counts).toBeNull();
});
