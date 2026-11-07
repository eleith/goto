import type { PreparedVisitReport } from '@goto/db/visit-reports';
import { expect, test } from 'vitest';
import { buildVisitReports } from './build-visit-reports.js';
import { reportPeriod } from './report-buckets.js';

test('places counts on the correct UTC days, Monday weeks and calendar months', () => {
	const period = reportPeriod(3, Date.parse('2026-07-01T12:00:00Z'));
	const reports = buildVisitReports(
		{
			daily: [
				{ scope: 'overview', day: '2026-05-31', total: 3, valid: 2, invalid: 1, base: 1 },
				{ scope: 'overview', day: '2026-06-01', total: 5, valid: 1, invalid: 4, base: 2 }
			],
			browsers: [],
			operatingSystems: []
		},
		[],
		period
	);
	const report = JSON.parse(
		reports.find((entry) => entry.key === 'overview')!.data
	) as PreparedVisitReport;
	const firstDay = period.days.findIndex(
		(bucket) => bucket.start === Date.parse('2026-05-30T00:00:00Z')
	);
	const firstWeek = period.weeks.findIndex(
		(bucket) => bucket.start === Date.parse('2026-05-25T00:00:00Z')
	);

	expect(report.daily.slice(firstDay, firstDay + 4)).toEqual([
		{ total: 0, valid: 0, invalid: 0, base: 0 },
		{ total: 3, valid: 2, invalid: 1, base: 1 },
		{ total: 5, valid: 1, invalid: 4, base: 2 },
		{ total: 0, valid: 0, invalid: 0, base: 0 }
	]);
	expect(report.weekly.slice(firstWeek, firstWeek + 2)).toEqual([
		{ total: 3, valid: 2, invalid: 1, base: 1 },
		{ total: 5, valid: 1, invalid: 4, base: 2 }
	]);
	expect(report.monthly).toEqual([
		{ total: 0, valid: 0, invalid: 0, base: 0 },
		{ total: 3, valid: 2, invalid: 1, base: 1 },
		{ total: 5, valid: 1, invalid: 4, base: 2 },
		{ total: 0, valid: 0, invalid: 0, base: 0 }
	]);
	expect(report.totals).toEqual({ total: 8, valid: 3, invalid: 5, base: 3 });
});
