import { expect, test } from 'vitest';
import {
	availableVisitTimeframes,
	countVisitWindows,
	groupVisitDays,
	resolveVisitTimeframe,
	sumVisitTotals,
	visitGranularity,
	visitWindow
} from './daily.js';
import { visitDays } from './period.js';
import type { ReportPeriod, VisitDetails } from './reports.js';

function dailyReport(
	from: string,
	asOf: string,
	counts: Record<string, [number, number]> = {}
): { period: ReportPeriod; daily: VisitDetails['daily'] } {
	const period: ReportPeriod = { from, asOf, timezone: 'UTC', retentionMonths: 3 };
	const daily = visitDays(period).map((day) => {
		const [validVisits, invalidVisits] = counts[day.start.slice(0, 10)] ?? [0, 0];
		return { ...day, validVisits, invalidVisits };
	});
	return { period, daily };
}

test('timeframe choices and automatic granularity follow retention', () => {
	expect(availableVisitTimeframes(3)).toEqual(['7d', '30d', 'all']);
	expect(availableVisitTimeframes(9)).toEqual(['7d', '30d', '90d', 'all']);
	expect(availableVisitTimeframes(12)).toEqual(['7d', '30d', '90d', 'all']);
	expect(visitGranularity('7d', 3)).toBe('day');
	expect(visitGranularity('30d', 9)).toBe('day');
	expect(visitGranularity('90d', 12)).toBe('week');
	expect(visitGranularity('all', 3)).toBe('week');
	expect(visitGranularity('all', 9)).toBe('month');
	expect(visitGranularity('all', 12)).toBe('month');
});

test('requested timeframes must be available and otherwise default to thirty days', () => {
	const available = availableVisitTimeframes(3);

	expect(resolveVisitTimeframe(available, '7d')).toBe('7d');
	expect(resolveVisitTimeframe(available, 'all')).toBe('all');
	expect(resolveVisitTimeframe(availableVisitTimeframes(9), '90d')).toBe('90d');
	expect(resolveVisitTimeframe(available, '90d')).toBe('30d');
	expect(resolveVisitTimeframe(available, 'unknown')).toBe('30d');
	expect(resolveVisitTimeframe(available, null)).toBe('30d');
});

test('day presets include the latest UTC calendar day rather than rolling hours', () => {
	const period: ReportPeriod = {
		from: '2023-12-01T12:00:00.000Z',
		asOf: '2024-03-01T12:00:00.000Z',
		timezone: 'UTC',
		retentionMonths: 3
	};

	expect(visitWindow(period, '7d')).toEqual({
		from: '2024-02-24T00:00:00.000Z',
		asOf: period.asOf
	});
	expect(visitWindow({ ...period, asOf: '2024-03-01T00:00:00.000Z' }, '7d')).toEqual({
		from: '2024-02-23T00:00:00.000Z',
		asOf: '2024-03-01T00:00:00.000Z'
	});
	expect(visitWindow(period, '30d')).toEqual({
		from: '2024-02-01T00:00:00.000Z',
		asOf: period.asOf
	});
	expect(visitWindow(period, '90d')).toEqual({
		from: '2023-12-03T00:00:00.000Z',
		asOf: period.asOf
	});
});

test('full windows preserve partial retention boundaries and presets cannot precede them', () => {
	const { period, daily } = dailyReport('2024-02-28T12:00:00.000Z', '2024-03-01T12:00:00.000Z', {
		'2024-02-28': [2, 1],
		'2024-02-29': [3, 0],
		'2024-03-01': [4, 1]
	});
	const original = { ...period };
	const window = visitWindow(period, 'all');

	expect(window).toEqual({ from: period.from, asOf: period.asOf });
	expect(visitWindow(period, '7d')).toEqual(window);
	expect(sumVisitTotals(daily, window)).toEqual({ validVisits: 9, invalidVisits: 2 });
	expect(groupVisitDays(daily, window, 'day')).toEqual(daily);
	expect(period).toEqual(original);
});

test('selected days are filtered before grouping and share the headline total without mutation', () => {
	const { period, daily } = dailyReport('2024-02-20T12:00:00.000Z', '2024-03-05T00:00:00.000Z', {
		'2024-02-26': [100, 100],
		'2024-02-27': [2, 50],
		'2024-02-29': [3, 1],
		'2024-03-04': [4, 2]
	});
	const original = structuredClone(daily);
	const window = visitWindow(period, '7d');
	const weeks = groupVisitDays(daily, window, 'week');

	expect(window.from).toBe('2024-02-27T00:00:00.000Z');
	expect(weeks).toEqual([
		{
			start: '2024-02-26T00:00:00.000Z',
			end: '2024-03-04T00:00:00.000Z',
			partial: true,
			validVisits: 5,
			invalidVisits: 51
		},
		{
			start: '2024-03-04T00:00:00.000Z',
			end: '2024-03-11T00:00:00.000Z',
			partial: true,
			validVisits: 4,
			invalidVisits: 2
		}
	]);
	expect(
		countVisitWindows(daily, [
			{ timeframe: '7d', window },
			{ timeframe: 'all', window: visitWindow(period, 'all') }
		])
	).toEqual({
		'7d': { validVisits: 9, invalidVisits: 53 },
		all: { validVisits: 109, invalidVisits: 153 }
	});
	expect(daily).toEqual(original);
});

test('missing daily reports stay absent while empty and zero-filled reports give window zeros', () => {
	const { period, daily } = dailyReport('2024-02-01T00:00:00.000Z', '2024-03-01T00:00:00.000Z');
	const timeframes = availableVisitTimeframes(3);
	const windows = timeframes.map((timeframe) => ({
		timeframe,
		window: visitWindow(period, timeframe)
	}));
	const zeros = {
		'7d': { validVisits: 0, invalidVisits: 0 },
		'30d': { validVisits: 0, invalidVisits: 0 },
		all: { validVisits: 0, invalidVisits: 0 }
	};

	expect(countVisitWindows(undefined, windows)).toEqual({});
	expect(countVisitWindows([], windows)).toEqual(zeros);
	expect(countVisitWindows(daily, windows)).toEqual(zeros);
});

test('days touching but outside the view are excluded from groups and totals', () => {
	const { daily } = dailyReport('2024-02-27T00:00:00.000Z', '2024-03-02T00:00:00.000Z', {
		'2024-02-27': [100, 100],
		'2024-02-28': [2, 1],
		'2024-02-29': [3, 2],
		'2024-03-01': [100, 100]
	});
	const window = { from: '2024-02-28T00:00:00.000Z', asOf: '2024-03-01T00:00:00.000Z' };

	expect(sumVisitTotals(daily, window)).toEqual({ validVisits: 5, invalidVisits: 3 });
	expect(groupVisitDays(daily, window, 'day')).toEqual(daily.slice(1, 3));
});

test('day grouping preserves UTC leap days, zero counts and partial window edges', () => {
	const { period, daily } = dailyReport('2024-02-28T12:00:00.000Z', '2024-03-01T12:00:00.000Z', {
		'2024-02-28': [2, 1],
		'2024-03-01': [4, 3]
	});

	expect(groupVisitDays(daily, period, 'day')).toEqual([
		{
			start: '2024-02-28T00:00:00.000Z',
			end: '2024-02-29T00:00:00.000Z',
			partial: true,
			validVisits: 2,
			invalidVisits: 1
		},
		{
			start: '2024-02-29T00:00:00.000Z',
			end: '2024-03-01T00:00:00.000Z',
			partial: false,
			validVisits: 0,
			invalidVisits: 0
		},
		{
			start: '2024-03-01T00:00:00.000Z',
			end: '2024-03-02T00:00:00.000Z',
			partial: true,
			validVisits: 4,
			invalidVisits: 3
		}
	]);
});

test('weeks start on UTC Monday across years and sum both outcomes without changing input', () => {
	const { period, daily } = dailyReport('2023-12-31T12:00:00.000Z', '2024-01-09T12:00:00.000Z', {
		'2023-12-31': [2, 1],
		'2024-01-08': [4, 3],
		'2024-01-09': [1, 2]
	});
	const original = structuredClone(daily);

	expect(groupVisitDays(daily, period, 'week')).toEqual([
		{
			start: '2023-12-25T00:00:00.000Z',
			end: '2024-01-01T00:00:00.000Z',
			partial: true,
			validVisits: 2,
			invalidVisits: 1
		},
		{
			start: '2024-01-01T00:00:00.000Z',
			end: '2024-01-08T00:00:00.000Z',
			partial: false,
			validVisits: 0,
			invalidVisits: 0
		},
		{
			start: '2024-01-08T00:00:00.000Z',
			end: '2024-01-15T00:00:00.000Z',
			partial: true,
			validVisits: 5,
			invalidVisits: 5
		}
	]);
	expect(daily).toEqual(original);
});

test('calendar months preserve empty months and include leap-day outcomes in February', () => {
	const { period, daily } = dailyReport('2023-12-31T12:00:00.000Z', '2024-03-01T12:00:00.000Z', {
		'2023-12-31': [2, 1],
		'2024-02-28': [3, 2],
		'2024-02-29': [4, 1],
		'2024-03-01': [1, 5]
	});

	expect(groupVisitDays(daily, period, 'month')).toEqual([
		{
			start: '2023-12-01T00:00:00.000Z',
			end: '2024-01-01T00:00:00.000Z',
			partial: true,
			validVisits: 2,
			invalidVisits: 1
		},
		{
			start: '2024-01-01T00:00:00.000Z',
			end: '2024-02-01T00:00:00.000Z',
			partial: false,
			validVisits: 0,
			invalidVisits: 0
		},
		{
			start: '2024-02-01T00:00:00.000Z',
			end: '2024-03-01T00:00:00.000Z',
			partial: false,
			validVisits: 7,
			invalidVisits: 3
		},
		{
			start: '2024-03-01T00:00:00.000Z',
			end: '2024-04-01T00:00:00.000Z',
			partial: true,
			validVisits: 1,
			invalidVisits: 5
		}
	]);
});

test('exact calendar boundaries are complete and do not add a following bucket', () => {
	const { period, daily } = dailyReport('2024-02-01T00:00:00.000Z', '2024-03-01T00:00:00.000Z');

	expect(groupVisitDays(daily, period, 'month')).toEqual([
		{
			start: '2024-02-01T00:00:00.000Z',
			end: '2024-03-01T00:00:00.000Z',
			partial: false,
			validVisits: 0,
			invalidVisits: 0
		}
	]);
	expect(sumVisitTotals(daily, period)).toEqual({ validVisits: 0, invalidVisits: 0 });
	expect(sumVisitTotals([], period)).toEqual({ validVisits: 0, invalidVisits: 0 });
	expect(groupVisitDays([], period, 'month')).toEqual([]);
});
