import type { VisitTimeframe, VisitWindow } from './daily.js';
import type { VisitDetails } from './reports.js';

export type VisitCountByName = { name: string; visits: number };
export type BrowserOsVisits = {
	browsers: VisitCountByName[];
	operatingSystems: VisitCountByName[];
};
export type BrowserOsVisitsByTimeframe = Partial<Record<VisitTimeframe, BrowserOsVisits>>;

export function countBrowserOsVisitsByTimeframe(
	details: Pick<VisitDetails, 'browsers' | 'operatingSystems'> | undefined,
	windows: Array<{ timeframe: VisitTimeframe; window: VisitWindow }>
): BrowserOsVisitsByTimeframe {
	const browserOsVisitsByTimeframe: BrowserOsVisitsByTimeframe = {};
	if (details === undefined) return browserOsVisitsByTimeframe;

	for (const { timeframe, window } of windows) {
		browserOsVisitsByTimeframe[timeframe] = {
			browsers: countVisitsByName(details.browsers, window),
			operatingSystems: countVisitsByName(details.operatingSystems, window)
		};
	}
	return browserOsVisitsByTimeframe;
}

function countVisitsByName(
	rows: VisitDetails['browsers'],
	window: VisitWindow
): VisitCountByName[] {
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
