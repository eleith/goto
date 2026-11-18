import { Value } from '@sinclair/typebox/value';
import { createVisitPeriod, visitDays } from './period.js';
import {
	VisitDetailsSchema,
	ReportPeriodSchema,
	ReportScopeSchema,
	type ReportPeriod,
	type ReportScope,
	type VisitDetails,
	type VisitTotals,
	type DailyVisitCountByName
} from './reports.js';

export function checkDetails(value: unknown): VisitDetails {
	if (!Value.Check(VisitDetailsSchema, value)) throw invalidReport();
	checkReportPeriod(value.period);
	const days = visitDays(value.period);
	if (value.daily.length !== days.length) throw invalidReport();
	const totals = new Map<string, VisitTotals>();
	const sum = { validVisits: 0, invalidVisits: 0 };
	for (const [index, day] of days.entries()) {
		const point = value.daily[index]!;
		if (point.start !== day.start || point.end !== day.end || point.partial !== day.partial)
			throw invalidReport();
		totals.set(day.start.slice(0, 10), point);
		sum.validVisits += point.validVisits;
		sum.invalidVisits += point.invalidVisits;
		if (!Number.isSafeInteger(sum.validVisits) || !Number.isSafeInteger(sum.invalidVisits))
			throw invalidReport();
	}
	checkDailyFamilyCounts(value.browsers, totals);
	checkDailyFamilyCounts(value.operatingSystems, totals);
	checkDailyLanguageMemberships(value.acceptedLanguages, totals);
	const hasVisits = value.daily.some((row) => row.validVisits > 0 || row.invalidVisits > 0);
	if ((value.lastActivityAt !== null) !== hasVisits) throw invalidReport();
	if (value.lastActivityAt !== null) {
		const activeDay = totals.get(value.lastActivityAt.slice(0, 10));
		if (!activeDay || (activeDay.validVisits === 0 && activeDay.invalidVisits === 0))
			throw invalidReport();
	}
	return value;
}

function checkDailyFamilyCounts(
	rows: DailyVisitCountByName[],
	daily: Map<string, VisitTotals>
): void {
	checkDailyMembershipBounds(rows, daily);
	const sums = new Map<string, VisitTotals>();
	for (const row of rows) {
		const sum = sums.get(row.day) ?? { validVisits: 0, invalidVisits: 0 };
		sum.validVisits += row.validVisits;
		sum.invalidVisits += row.invalidVisits;
		if (!Number.isSafeInteger(sum.validVisits) || !Number.isSafeInteger(sum.invalidVisits))
			throw invalidReport();
		sums.set(row.day, sum);
	}
	for (const [day, totals] of daily) {
		const sum = sums.get(day) ?? { validVisits: 0, invalidVisits: 0 };
		if (sum.validVisits !== totals.validVisits || sum.invalidVisits !== totals.invalidVisits)
			throw invalidReport();
	}
}

function checkDailyLanguageMemberships(
	rows: DailyVisitCountByName[],
	daily: Map<string, VisitTotals>
): void {
	checkDailyMembershipBounds(rows, daily);
}

function checkDailyMembershipBounds(
	rows: DailyVisitCountByName[],
	daily: Map<string, VisitTotals>
): void {
	const seen = new Set<string>();
	for (const row of rows) {
		const key = JSON.stringify([row.day, row.name]);
		const totals = daily.get(row.day);
		if (
			seen.has(key) ||
			!totals ||
			!withinTotals(row, totals) ||
			(row.validVisits === 0 && row.invalidVisits === 0)
		)
			throw invalidReport();
		seen.add(key);
	}
}

export function checkReportScope(value: unknown): ReportScope {
	if (!Value.Check(ReportScopeSchema, value)) throw invalidReport();
	return value;
}

export function checkReportPeriod(value: unknown): ReportPeriod {
	if (!Value.Check(ReportPeriodSchema, value)) throw invalidReport();
	const period = value;
	let expected: ReportPeriod;
	try {
		expected = createVisitPeriod(period.retentionMonths, Date.parse(period.asOf));
	} catch {
		throw invalidReport();
	}
	if (!samePeriod(period, expected)) throw invalidReport();
	return period;
}

function samePeriod(left: ReportPeriod, right: ReportPeriod): boolean {
	return (
		left.from === right.from &&
		left.asOf === right.asOf &&
		left.timezone === right.timezone &&
		left.retentionMonths === right.retentionMonths
	);
}

export function sameScope(left: ReportScope, right: ReportScope): boolean {
	if (left.kind === 'overview') return right.kind === 'overview';
	if (left.kind === 'domain') return right.kind === 'domain' && left.domain === right.domain;
	return right.kind === 'link' && left.domain === right.domain && left.path === right.path;
}

export function withinTotals(subset: VisitTotals, totals: VisitTotals): boolean {
	return subset.validVisits <= totals.validVisits && subset.invalidVisits <= totals.invalidVisits;
}

export function invalidReport(): Error {
	return new Error('Invalid analytics report');
}
