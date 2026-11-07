import { visitDays } from './period.js';
import {
	zeroVisitTotals,
	type PreparedVisitReport,
	type SerializedVisitReport,
	type VisitDetails,
	type VisitSummary,
	type VisitTotals
} from './reports.js';
import {
	checkDetails,
	checkSummary,
	equalTotals,
	invalidReport,
	samePeriod,
	sameScope,
	withinTotals
} from './validation.js';

export function encodeVisitReports(reports: PreparedVisitReport[]): SerializedVisitReport[] {
	const first = reports[0];
	if (!first) return [];
	let overview = false;
	const domains = new Set<string>();
	const links = new Map<string, Set<string>>();
	for (const report of reports) {
		const summary = checkSummary(report.summary);
		const details = checkDetails(report.details);
		if (
			!sameScope(summary.scope, details.scope) ||
			!samePeriod(summary.period, details.period) ||
			!samePeriod(summary.period, first.summary.period)
		) {
			throw invalidReport();
		}
		const scope = summary.scope;
		if (scope.kind === 'overview') {
			if (overview) throw invalidReport();
			overview = true;
		} else if (scope.kind === 'domain') {
			if (domains.has(scope.domain)) throw invalidReport();
			domains.add(scope.domain);
		} else {
			const paths = links.get(scope.domain) ?? new Set<string>();
			if (paths.has(scope.path)) throw invalidReport();
			paths.add(scope.path);
			links.set(scope.domain, paths);
		}
	}

	const days = visitDays(first.summary.period);
	for (const { summary, details } of reports) {
		checkDailyLayout(details.daily, days);
		const totals = sumTotals(details.daily);
		if (!equalTotals(summary.totals, totals)) throw invalidReport();
		checkFamilies(details.browsers, totals);
		checkFamilies(details.operatingSystems, totals);
		checkChildren(summary);
	}

	return reports.map(({ summary, details }) => ({
		scope: summary.scope,
		summaryJson: JSON.stringify(summary),
		detailsJson: JSON.stringify(details)
	}));
}

function checkDailyLayout(daily: VisitDetails['daily'], days: ReturnType<typeof visitDays>): void {
	if (daily.length !== days.length) throw invalidReport();
	for (const [index, day] of days.entries()) {
		const point = daily[index];
		if (
			!point ||
			point.start !== day.start ||
			point.end !== day.end ||
			point.partial !== day.partial
		) {
			throw invalidReport();
		}
	}
}

function checkFamilies(rows: VisitDetails['browsers'], totals: VisitTotals): void {
	const families = new Set(rows.map(({ family }) => family));
	const combined = sumTotals(rows);
	if (families.size !== rows.length || !equalTotals(combined, totals)) {
		throw invalidReport();
	}
}

function checkChildren(summary: VisitSummary): void {
	if ('domains' in summary) {
		if (new Set(summary.domains.map(({ domain }) => domain)).size !== summary.domains.length) {
			throw invalidReport();
		}
		const childTotals = summary.domains.map(({ totals }) => totals);
		const combined = sumTotals(childTotals);
		if (!withinTotals(combined, summary.totals)) throw invalidReport();
	} else if ('links' in summary) {
		if (new Set(summary.links.map(({ path }) => path)).size !== summary.links.length) {
			throw invalidReport();
		}
		const childTotals = summary.links.map(({ totals }) => totals);
		const combined = sumTotals(childTotals);
		if (!withinTotals(combined, summary.totals)) throw invalidReport();
	}
}

function sumTotals(rows: VisitTotals[]): VisitTotals {
	const totals = zeroVisitTotals();
	for (const row of rows) {
		totals.validVisits += row.validVisits;
		totals.invalidVisits += row.invalidVisits;
	}
	if (!Number.isSafeInteger(totals.validVisits) || !Number.isSafeInteger(totals.invalidVisits)) {
		throw invalidReport();
	}
	return totals;
}
