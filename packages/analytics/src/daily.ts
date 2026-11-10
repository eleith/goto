import type { ReportPeriod, VisitDetails, VisitTotals } from './reports.js';

export type VisitTimeframe = '7d' | '30d' | '90d' | 'all';
export type VisitCountsByTimeframe = Partial<Record<VisitTimeframe, VisitTotals>>;
export type VisitWindow = { from: string; asOf: string };
export type VisitGranularity = 'day' | 'week' | 'month';

const daysByTimeframe = { '7d': 7, '30d': 30, '90d': 90 };

export function availableVisitTimeframes(months: 3 | 9 | 12): VisitTimeframe[] {
	return months === 3 ? ['7d', '30d', 'all'] : ['7d', '30d', '90d', 'all'];
}

export function resolveVisitTimeframe(
	available: VisitTimeframe[],
	requested: string | null
): VisitTimeframe {
	for (const timeframe of available) {
		if (timeframe === requested) return timeframe;
	}
	return '30d';
}

export function visitWindow(period: ReportPeriod, timeframe: VisitTimeframe): VisitWindow {
	if (timeframe === 'all') {
		return { from: period.from, asOf: period.asOf };
	}

	const days = daysByTimeframe[timeframe];
	const start = new Date(Date.parse(period.asOf) - 1);
	start.setUTCHours(0, 0, 0, 0);
	start.setUTCDate(start.getUTCDate() - (days - 1));
	return {
		from: new Date(Math.max(start.getTime(), Date.parse(period.from))).toISOString(),
		asOf: period.asOf
	};
}

export function sumVisitTotals(daily: VisitDetails['daily'], window: VisitWindow): VisitTotals {
	const from = Date.parse(window.from);
	const asOf = Date.parse(window.asOf);
	const totals: VisitTotals = { validVisits: 0, invalidVisits: 0 };
	for (const day of daily) {
		if (intersectsWindow(day, from, asOf)) {
			totals.validVisits += day.validVisits;
			totals.invalidVisits += day.invalidVisits;
		}
	}
	return totals;
}

export function countVisitWindows(
	daily: VisitDetails['daily'] | undefined,
	windows: Array<{ timeframe: VisitTimeframe; window: VisitWindow }>
): VisitCountsByTimeframe {
	const counts: VisitCountsByTimeframe = {};
	if (daily === undefined) return counts;

	for (const { timeframe, window } of windows) {
		counts[timeframe] = sumVisitTotals(daily, window);
	}
	return counts;
}

export function visitGranularity(timeframe: VisitTimeframe, months: 3 | 9 | 12): VisitGranularity {
	if (timeframe === '7d' || timeframe === '30d') return 'day';
	if (timeframe === '90d' || months === 3) return 'week';
	return 'month';
}

export function groupVisitDays(
	daily: VisitDetails['daily'],
	window: VisitWindow,
	granularity: VisitGranularity
): VisitDetails['daily'] {
	const groups: VisitDetails['daily'] = [];
	const from = Date.parse(window.from);
	const asOf = Date.parse(window.asOf);

	for (const day of daily) {
		if (!intersectsWindow(day, from, asOf)) continue;

		const start = groupStart(day.start, granularity);
		const startInstant = start.toISOString();
		const previous = groups.at(-1);
		if (previous?.start === startInstant) {
			previous.validVisits += day.validVisits;
			previous.invalidVisits += day.invalidVisits;
			continue;
		}

		const end = new Date(start);
		if (granularity === 'month') {
			end.setUTCMonth(end.getUTCMonth() + 1);
		} else {
			end.setUTCDate(end.getUTCDate() + (granularity === 'week' ? 7 : 1));
		}
		groups.push({
			start: startInstant,
			end: end.toISOString(),
			partial: start.getTime() < from || end.getTime() > asOf,
			validVisits: day.validVisits,
			invalidVisits: day.invalidVisits
		});
	}

	return groups;
}

function intersectsWindow(day: VisitDetails['daily'][number], from: number, asOf: number): boolean {
	return Date.parse(day.start) < asOf && Date.parse(day.end) > from;
}

function groupStart(instant: string, granularity: VisitGranularity): Date {
	const start = new Date(instant);
	start.setUTCHours(0, 0, 0, 0);
	if (granularity === 'week') {
		const daysSinceMonday = (start.getUTCDay() + 6) % 7;
		start.setUTCDate(start.getUTCDate() - daysSinceMonday);
	} else if (granularity === 'month') {
		start.setUTCDate(1);
	}
	return start;
}
