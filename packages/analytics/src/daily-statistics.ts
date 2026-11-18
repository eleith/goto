import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { visitDays } from './period.js';
import {
	VisitDetailsSchema,
	VisitTotalsSchema,
	zeroVisitTotals,
	type ReportPeriod,
	type ReportScope,
	type VisitDetails,
	type VisitTotals
} from './reports.js';
import {
	checkDetails,
	checkReportPeriod,
	invalidReport,
	sameScope,
	withinTotals
} from './validation.js';

const exact = { additionalProperties: false };
const namedCounts = Type.Array(
	Type.Object(
		{
			name: Type.String({ minLength: 1 }),
			...VisitTotalsSchema.properties
		},
		exact
	)
);

const DailyVisitStatisticsSchema = Type.Object(
	{
		scope: VisitDetailsSchema.properties.scope,
		day: VisitDetailsSchema.properties.browsers.items.properties.day,
		lastVisitAt: Type.Integer({ minimum: -62_167_219_200_000, maximum: 253_402_300_799_999 }),
		...VisitTotalsSchema.properties,
		browsers: namedCounts,
		operatingSystems: namedCounts,
		acceptedLanguages: Type.Array(
			Type.Object(
				{
					name: VisitDetailsSchema.properties.acceptedLanguages.items.properties.name,
					...VisitTotalsSchema.properties
				},
				exact
			)
		)
	},
	exact
);
export type DailyVisitStatistics = Static<typeof DailyVisitStatisticsSchema>;
type NamedCounts = DailyVisitStatistics['browsers'];

export function emptyDailyStatistics(scope: ReportScope, day: string): DailyVisitStatistics {
	return checkDailyStatistics({
		scope,
		day,
		lastVisitAt: Date.parse(`${day}T00:00:00.000Z`),
		...zeroVisitTotals(),
		browsers: [],
		operatingSystems: [],
		acceptedLanguages: []
	});
}

export function checkDailyStatistics(value: unknown): DailyVisitStatistics {
	if (!Value.Check(DailyVisitStatisticsSchema, value)) throw invalidReport();
	if (new Date(value.lastVisitAt).toISOString().slice(0, 10) !== value.day) throw invalidReport();
	checkFamilyCounts(value.browsers, value);
	checkFamilyCounts(value.operatingSystems, value);
	checkLanguageMemberships(value.acceptedLanguages, value);
	return value;
}

export function addDailyStatistics(
	current: DailyVisitStatistics | null,
	added: DailyVisitStatistics
): DailyVisitStatistics {
	checkDailyStatistics(added);
	const previous =
		current === null ? emptyDailyStatistics(added.scope, added.day) : checkDailyStatistics(current);
	checkSameDayAndScope(previous, added);
	return checkDailyStatistics({
		scope: added.scope,
		day: added.day,
		lastVisitAt: Math.max(previous.lastVisitAt, added.lastVisitAt),
		validVisits: previous.validVisits + added.validVisits,
		invalidVisits: previous.invalidVisits + added.invalidVisits,
		browsers: addNamedCounts(previous.browsers, added.browsers),
		operatingSystems: addNamedCounts(previous.operatingSystems, added.operatingSystems),
		acceptedLanguages: addNamedCounts(previous.acceptedLanguages, added.acceptedLanguages)
	});
}

export function subtractDailyStatistics(
	current: DailyVisitStatistics,
	expired: DailyVisitStatistics
): DailyVisitStatistics | null {
	checkDailyStatistics(current);
	checkDailyStatistics(expired);
	checkSameDayAndScope(current, expired);
	const remaining = checkDailyStatistics({
		scope: current.scope,
		day: current.day,
		lastVisitAt: current.lastVisitAt,
		validVisits: current.validVisits - expired.validVisits,
		invalidVisits: current.invalidVisits - expired.invalidVisits,
		browsers: subtractNamedCounts(current.browsers, expired.browsers),
		operatingSystems: subtractNamedCounts(current.operatingSystems, expired.operatingSystems),
		acceptedLanguages: subtractNamedCounts(current.acceptedLanguages, expired.acceptedLanguages)
	});
	return remaining.validVisits === 0 && remaining.invalidVisits === 0 ? null : remaining;
}

export function canSubtractDailyStatistics(
	current: DailyVisitStatistics,
	expired: DailyVisitStatistics
): boolean {
	checkDailyStatistics(current);
	checkDailyStatistics(expired);
	checkSameDayAndScope(current, expired);
	const remaining = {
		validVisits: current.validVisits - expired.validVisits,
		invalidVisits: current.invalidVisits - expired.invalidVisits
	};
	if (remaining.validVisits < 0 || remaining.invalidVisits < 0) return false;
	const browsers = subtractNamedCounts(current.browsers, expired.browsers);
	const operatingSystems = subtractNamedCounts(current.operatingSystems, expired.operatingSystems);
	const acceptedLanguages = subtractNamedCounts(
		current.acceptedLanguages,
		expired.acceptedLanguages
	);
	return (
		namedCountsWithinTotals(browsers, remaining) &&
		namedCountsWithinTotals(operatingSystems, remaining) &&
		namedCountsWithinTotals(acceptedLanguages, remaining)
	);
}

export function projectVisitDetails(
	scope: ReportScope,
	period: ReportPeriod,
	statistics: DailyVisitStatistics[]
): VisitDetails {
	checkReportPeriod(period);
	const days = visitDays(period);
	const included = new Set(days.map(({ start }) => start.slice(0, 10)));
	const selected = new Map<string, DailyVisitStatistics>();
	for (const row of statistics) {
		checkDailyStatistics(row);
		if (!sameScope(row.scope, scope) || selected.has(row.day)) throw invalidReport();
		selected.set(row.day, row);
	}
	const visible = [...selected.values()]
		.filter(({ day }) => included.has(day))
		.sort((left, right) => left.day.localeCompare(right.day));
	const active = visible.filter((row) => row.validVisits > 0 || row.invalidVisits > 0);
	return checkDetails({
		version: 5,
		scope,
		period,
		lastActivityAt:
			active.length === 0
				? null
				: new Date(Math.max(...active.map(({ lastVisitAt }) => lastVisitAt))).toISOString(),
		daily: days.map((day) => {
			const counts = selected.get(day.start.slice(0, 10)) ?? zeroVisitTotals();
			return { ...day, validVisits: counts.validVisits, invalidVisits: counts.invalidVisits };
		}),
		browsers: visible.flatMap((row) => row.browsers.map((counts) => ({ day: row.day, ...counts }))),
		operatingSystems: visible.flatMap((row) =>
			row.operatingSystems.map((counts) => ({ day: row.day, ...counts }))
		),
		acceptedLanguages: visible.flatMap((row) =>
			row.acceptedLanguages.map((counts) => ({ day: row.day, ...counts }))
		)
	});
}

function checkSameDayAndScope(current: DailyVisitStatistics, other: DailyVisitStatistics): void {
	if (!sameScope(current.scope, other.scope) || current.day !== other.day) throw invalidReport();
}

function checkFamilyCounts(rows: NamedCounts, totals: VisitTotals): void {
	checkNamedMembershipBounds(rows, totals);
	const sum = zeroVisitTotals();
	for (const row of rows) {
		sum.validVisits += row.validVisits;
		sum.invalidVisits += row.invalidVisits;
		if (!Number.isSafeInteger(sum.validVisits) || !Number.isSafeInteger(sum.invalidVisits))
			throw invalidReport();
	}
	if (sum.validVisits !== totals.validVisits || sum.invalidVisits !== totals.invalidVisits)
		throw invalidReport();
}

function checkLanguageMemberships(rows: NamedCounts, totals: VisitTotals): void {
	checkNamedMembershipBounds(rows, totals);
}

function checkNamedMembershipBounds(rows: NamedCounts, totals: VisitTotals): void {
	const seen = new Set<string>();
	for (const row of rows) {
		if (
			seen.has(row.name) ||
			!withinTotals(row, totals) ||
			(row.validVisits === 0 && row.invalidVisits === 0)
		)
			throw invalidReport();
		seen.add(row.name);
	}
}

function namedCountsWithinTotals(rows: NamedCounts, totals: VisitTotals): boolean {
	return rows.every(
		(row) => row.validVisits >= 0 && row.invalidVisits >= 0 && withinTotals(row, totals)
	);
}

function addNamedCounts(current: NamedCounts, added: NamedCounts): NamedCounts {
	const combined = new Map(current.map((row) => [row.name, { ...row }]));
	for (const row of added) {
		const previous = combined.get(row.name) ?? { name: row.name, ...zeroVisitTotals() };
		combined.set(row.name, {
			name: row.name,
			validVisits: previous.validVisits + row.validVisits,
			invalidVisits: previous.invalidVisits + row.invalidVisits
		});
	}
	return sortedNonzeroCounts([...combined.values()]);
}

function subtractNamedCounts(current: NamedCounts, expired: NamedCounts): NamedCounts {
	const remaining = new Map(current.map((row) => [row.name, { ...row }]));
	for (const row of expired) {
		const previous = remaining.get(row.name) ?? { name: row.name, ...zeroVisitTotals() };
		remaining.set(row.name, {
			name: row.name,
			validVisits: previous.validVisits - row.validVisits,
			invalidVisits: previous.invalidVisits - row.invalidVisits
		});
	}
	return sortedNonzeroCounts([...remaining.values()]);
}

function sortedNonzeroCounts(rows: NamedCounts): NamedCounts {
	return rows
		.filter((row) => row.validVisits !== 0 || row.invalidVisits !== 0)
		.sort((left, right) => left.name.localeCompare(right.name));
}
