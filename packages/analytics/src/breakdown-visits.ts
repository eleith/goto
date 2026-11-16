import type { VisitTimeframe, VisitWindow } from './daily.js';
import type { DailyVisitCountByName } from './reports.js';

export type VisitCountByName = { name: string; visits: number };
export type BreakdownVisitsByTimeframe = Partial<Record<VisitTimeframe, VisitCountByName[]>>;

export function countBreakdownVisitsByTimeframe(
	rows: DailyVisitCountByName[] | undefined,
	windows: Array<{ timeframe: VisitTimeframe; window: VisitWindow }>
): BreakdownVisitsByTimeframe {
	const breakdownVisitsByTimeframe: BreakdownVisitsByTimeframe = {};
	if (rows === undefined) return breakdownVisitsByTimeframe;

	for (const { timeframe, window } of windows) {
		breakdownVisitsByTimeframe[timeframe] = countVisitsByName(rows, window);
	}
	return breakdownVisitsByTimeframe;
}

function countVisitsByName(rows: DailyVisitCountByName[], window: VisitWindow): VisitCountByName[] {
	const from = Date.parse(window.from);
	const asOf = Date.parse(window.asOf);
	const counts = new Map<string, number>();
	for (const row of rows) {
		const start = Date.parse(`${row.day}T00:00:00.000Z`);
		if (start >= asOf || start + 86_400_000 <= from || row.validVisits === 0) continue;
		counts.set(row.name, (counts.get(row.name) ?? 0) + row.validVisits);
	}
	return [...counts]
		.map(([name, visits]) => ({ name, visits }))
		.sort((left, right) => right.visits - left.visits || left.name.localeCompare(right.name, 'en'));
}
