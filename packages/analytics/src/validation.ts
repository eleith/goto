import { Value } from '@sinclair/typebox/value';
import { createVisitPeriod } from './period.js';
import {
	VisitDetailsSchema,
	VisitSummarySchema,
	type ReportPeriod,
	type ReportScope,
	type VisitDetails,
	type VisitSummary,
	type VisitTotals
} from './reports.js';

export function checkSummary(value: unknown): VisitSummary {
	if (!Value.Check(VisitSummarySchema, value)) throw invalidReport();
	checkPeriod(value.period);
	if ('base' in value && !withinTotals(value.base, value.totals)) throw invalidReport();
	return value;
}

export function checkDetails(value: unknown): VisitDetails {
	if (!Value.Check(VisitDetailsSchema, value)) throw invalidReport();
	checkPeriod(value.period);
	const from = Date.parse(value.period.from);
	const asOf = Date.parse(value.period.asOf);
	const dayMilliseconds = 86_400_000;
	const earliestStart = Math.floor(from / dayMilliseconds) * dayMilliseconds;
	const latestEnd = Math.ceil(asOf / dayMilliseconds) * dayMilliseconds;
	for (const point of value.daily) {
		const start = Date.parse(point.start);
		const end = Date.parse(point.end);
		if (start < earliestStart || end > latestEnd || start >= end || start >= asOf || end <= from) {
			throw invalidReport();
		}
	}
	for (const row of [...value.browsers, ...value.operatingSystems, ...value.acceptedLanguages]) {
		const start = Date.parse(`${row.day}T00:00:00.000Z`);
		if (start >= asOf || start + dayMilliseconds <= from) throw invalidReport();
	}
	return value;
}

function checkPeriod(period: ReportPeriod): void {
	let expected: ReportPeriod;
	try {
		expected = createVisitPeriod(period.retentionMonths, Date.parse(period.asOf));
	} catch {
		throw invalidReport();
	}
	if (!samePeriod(period, expected)) throw invalidReport();
}

export function samePeriod(left: ReportPeriod, right: ReportPeriod): boolean {
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

export function equalTotals(left: VisitTotals, right: VisitTotals): boolean {
	return left.validVisits === right.validVisits && left.invalidVisits === right.invalidVisits;
}

export function withinTotals(subset: VisitTotals, totals: VisitTotals): boolean {
	return subset.validVisits <= totals.validVisits && subset.invalidVisits <= totals.invalidVisits;
}

export function invalidReport(): Error {
	return new Error('Invalid analytics report');
}
