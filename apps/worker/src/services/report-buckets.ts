import type { TimeBucket, VisitReportPeriod } from '@goto/db/visit-reports';
import { retentionCutoff, type RetentionMonths } from './retention.js';

type BucketSize = 'day' | 'week' | 'month';

export function reportPeriod(months: Exclude<RetentionMonths, 0>, asOf: number): VisitReportPeriod {
	const since = retentionCutoff(months, asOf);
	return {
		timezone: 'UTC',
		retentionMonths: months,
		since,
		asOf,
		days: timeBuckets(since, asOf, 'day'),
		weeks: timeBuckets(since, asOf, 'week'),
		months: timeBuckets(since, asOf, 'month')
	};
}

function timeBuckets(since: number, asOf: number, size: BucketSize): TimeBucket[] {
	const date = new Date(since);
	date.setUTCHours(0, 0, 0, 0);
	if (size === 'week') {
		const daysSinceMonday = (date.getUTCDay() + 6) % 7;
		date.setUTCDate(date.getUTCDate() - daysSinceMonday);
	}
	if (size === 'month') date.setUTCDate(1);
	const buckets: TimeBucket[] = [];
	while (date.getTime() < asOf) {
		const start = date.getTime();
		if (size === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
		else date.setUTCDate(date.getUTCDate() + (size === 'week' ? 7 : 1));
		const end = date.getTime();
		buckets.push({ start, end, partial: start < since || end > asOf });
	}
	return buckets;
}
