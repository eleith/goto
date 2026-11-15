import { visitDays, zeroVisitTotals, type VisitDetails, type VisitTotals } from '@goto/analytics';
import type { LinkVisitDetails } from '@goto/db/visit-reports';

export function combineTagVisits(
	report: LinkVisitDetails
): Pick<VisitDetails, 'period' | 'daily' | 'browsers' | 'operatingSystems' | 'acceptedLanguages'> {
	const countsByDay = new Map<string, VisitTotals>();
	for (const { details } of report.links) {
		for (const point of details.daily) {
			const day = point.start.slice(0, 10);
			const counts = countsByDay.get(day) ?? zeroVisitTotals();
			counts.validVisits += point.validVisits;
			counts.invalidVisits += point.invalidVisits;
			countsByDay.set(day, counts);
		}
	}
	const daily = visitDays(report.period).map((day) => {
		const counts = countsByDay.get(day.start.slice(0, 10)) ?? zeroVisitTotals();
		return { ...day, ...counts };
	});
	return {
		period: report.period,
		daily,
		browsers: combineNamedCounts(report.links.map(({ details }) => details.browsers)),
		operatingSystems: combineNamedCounts(
			report.links.map(({ details }) => details.operatingSystems)
		),
		acceptedLanguages: combineNamedCounts(
			report.links.map(({ details }) => details.acceptedLanguages)
		)
	};
}

function combineNamedCounts(groups: VisitDetails['browsers'][]): VisitDetails['browsers'] {
	const countsByDay = new Map<string, Map<string, VisitDetails['browsers'][number]>>();
	for (const rows of groups) {
		for (const row of rows) {
			let countsByName = countsByDay.get(row.day);
			if (!countsByName) {
				countsByName = new Map();
				countsByDay.set(row.day, countsByName);
			}
			const counts = countsByName.get(row.name);
			if (counts) {
				counts.validVisits += row.validVisits;
				counts.invalidVisits += row.invalidVisits;
			} else {
				countsByName.set(row.name, { ...row });
			}
		}
	}
	return [...countsByDay.values()]
		.flatMap((countsByName) => [...countsByName.values()])
		.sort(
			(left, right) =>
				left.day.localeCompare(right.day) || left.name.localeCompare(right.name, 'en')
		);
}
