import { expect, test } from 'vitest';
import { visitWindow, type VisitTimeframe } from './daily.js';
import { countBreakdownVisitsByTimeframe, type DailyVisitCountByName } from './index.js';
import { createVisitPeriod } from './period.js';

test('counts only valid visits in each UTC timeframe, combining named counts and sorting ties by name', () => {
	const period = createVisitPeriod(3, Date.parse('2026-06-15T12:00:00.000Z'));
	const rows: DailyVisitCountByName[] = [
		{ day: '2026-03-17', name: 'Other', validVisits: 100, invalidVisits: 0 },
		{ day: '2026-06-09', name: 'Firefox', validVisits: 2, invalidVisits: 40 },
		{ day: '2026-06-09', name: 'Chrome', validVisits: 3, invalidVisits: 0 },
		{ day: '2026-06-15', name: 'Firefox', validVisits: 2, invalidVisits: 0 },
		{ day: '2026-06-15', name: 'Chrome', validVisits: 1, invalidVisits: 0 },
		{ day: '2026-06-15', name: 'Other', validVisits: 5, invalidVisits: 0 },
		{ day: '2026-06-15', name: 'Safari', validVisits: 0, invalidVisits: 90 },
		{ day: '2026-06-16', name: 'Firefox', validVisits: 100, invalidVisits: 0 }
	];
	const original = structuredClone(rows);
	const timeframes: VisitTimeframe[] = ['7d', 'all'];
	const windows = timeframes.map((timeframe) => ({
		timeframe,
		window: visitWindow(period, timeframe)
	}));

	expect(countBreakdownVisitsByTimeframe(rows, windows)).toEqual({
		'7d': [
			{ name: 'Other', visits: 5 },
			{ name: 'Chrome', visits: 4 },
			{ name: 'Firefox', visits: 4 }
		],
		all: [
			{ name: 'Other', visits: 105 },
			{ name: 'Chrome', visits: 4 },
			{ name: 'Firefox', visits: 4 }
		]
	});
	expect(rows).toEqual(original);
});

test('intersects UTC days at partial and exclusive boundaries rather than filtering by midnight alone', () => {
	const rows = [
		{ day: '2024-02-27', name: 'Other', validVisits: 100, invalidVisits: 0 },
		{ day: '2024-02-28', name: 'Other', validVisits: 2, invalidVisits: 0 },
		{ day: '2024-02-29', name: 'Other', validVisits: 3, invalidVisits: 0 },
		{ day: '2024-03-01', name: 'Other', validVisits: 100, invalidVisits: 0 }
	];
	expect(
		countBreakdownVisitsByTimeframe(rows, [
			{
				timeframe: 'all',
				window: { from: '2024-02-28T12:00:00.000Z', asOf: '2024-03-01T00:00:00.000Z' }
			}
		])
	).toEqual({
		all: [{ name: 'Other', visits: 5 }]
	});
});

test('missing rows remain unavailable while empty and invalid-only rows have explicit empty windows', () => {
	const period = createVisitPeriod(3, Date.parse('2026-06-15T12:00:00.000Z'));
	const timeframes: VisitTimeframe[] = ['7d', '30d', 'all'];
	const windows = timeframes.map((timeframe) => ({
		timeframe,
		window: visitWindow(period, timeframe)
	}));
	const empty = { '7d': [], '30d': [], all: [] };

	expect(countBreakdownVisitsByTimeframe(undefined, windows)).toEqual({});
	expect(countBreakdownVisitsByTimeframe([], windows)).toEqual(empty);
	const rows = [{ day: '2026-06-15', name: 'Other', validVisits: 0, invalidVisits: 5 }];
	expect(countBreakdownVisitsByTimeframe(rows, windows)).toEqual(empty);
});
