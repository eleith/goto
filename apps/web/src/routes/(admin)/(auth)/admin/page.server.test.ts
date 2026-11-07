import { validateConfig } from '@goto/config';
import type { StoredVisitReports } from '@goto/db/visit-reports';
import { beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readVisitReport } from '#lib/server/visit-reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visit-reports.js', () => ({ readVisitReport: vi.fn() }));
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

test('shows current configuration and the worker-prepared snapshot without re-aggregating', async () => {
	const counts = { total: 4, valid: 2, invalid: 2, base: 1 };
	const report = {
		totals: { ...counts, total: 9, valid: 7 },
		daily: [],
		weekly: [],
		monthly: [],
		browsers: [],
		operatingSystems: [],
		domainCounts: [{ domain: 'go.example.test', counts }],
		linkCounts: []
	};
	const prepared: StoredVisitReports = {
		period: {
			timezone: 'UTC',
			retentionMonths: 3,
			since: 100,
			asOf: 200,
			days: [],
			weeks: [],
			months: []
		},
		report,
		selection: report
	};
	vi.mocked(readVisitReport).mockResolvedValue(prepared);
	const data = await load(request());
	if (!data) throw new Error('Missing page data');
	expect(data.domainCount).toBe(1);
	expect(data.linkCount).toBe(2);
	expect(data.totals?.total).toBe(9);
	expect(data.asOf).toBe(200);
	expect(data.domains[0]?.href).toBe('/admin/domains/go.example.test');
});

test('disabled collection does not read a report; missing preparation is not zero', async () => {
	const disabled = await load(request(0));
	if (!disabled) throw new Error('Missing disabled page');
	expect(disabled.collectionEnabled).toBe(false);
	expect(disabled.totals).toBeNull();
	expect(readVisitReport).not.toHaveBeenCalled();
	vi.mocked(readVisitReport).mockResolvedValue(null);
	const unavailable = await load(request());
	if (!unavailable) throw new Error('Missing unavailable page');
	expect(unavailable.available).toBe(false);
	expect(unavailable.domains[0]?.counts).toBeNull();
});
