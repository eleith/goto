import {
	addDailyStatistics,
	canSubtractDailyStatistics,
	checkDailyStatistics,
	checkReportPeriod,
	checkReportScope,
	subtractDailyStatistics,
	projectVisitDetails,
	visitDays,
	type DailyVisitStatistics,
	type ReportPeriod,
	type ReportScope,
	type VisitDetails,
	type VisitTotals
} from '@goto/analytics';
import { sql, type Kysely, type RawBuilder, type Selectable } from 'kysely';
import type { Database, VisitDailyStatisticsTable } from '../types.js';

type DailyStatisticsRow = Selectable<VisitDailyStatisticsTable>;

export interface DailyStatisticsMismatch {
	scope: ReportScope;
	day: string;
	rowId: number | null;
	reason: 'missing' | 'contribution-mismatch';
	stored: VisitTotals | null;
	removing: VisitTotals;
}

export async function addDailyVisitStatistics(
	db: Kysely<Database>,
	additions: DailyVisitStatistics[]
): Promise<void> {
	if (!db.isTransaction) throw new Error('Daily statistics require a writer transaction');
	for (const added of additions) {
		checkDailyStatistics(added);
		if (added.validVisits === 0 && added.invalidVisits === 0) continue;
		const current = await readStoredDay(db, added.scope, added.day);
		const stored = current ? decodeDailyStatistics(current) : null;
		const combined = addDailyStatistics(stored, added);
		await saveDailyAddition(db, added, combined);
	}
}

export async function subtractDailyVisitStatistics(
	db: Kysely<Database>,
	expirations: DailyVisitStatistics[]
): Promise<DailyStatisticsMismatch[]> {
	if (!db.isTransaction) throw new Error('Daily statistics require a writer transaction');
	const mismatches: DailyStatisticsMismatch[] = [];
	for (const expired of expirations) {
		checkDailyStatistics(expired);
		if (expired.validVisits === 0 && expired.invalidVisits === 0) continue;
		const current = await readStoredDay(db, expired.scope, expired.day);
		if (!current) {
			mismatches.push(missingBucketMismatch(expired));
			continue;
		}
		const stored = decodeDailyStatistics(current);
		if (!canSubtractDailyStatistics(stored, expired)) {
			mismatches.push(incompatibleBucketMismatch(current.id, stored, expired));
			continue;
		}
		const remaining = subtractDailyStatistics(stored, expired);
		if (remaining === null) {
			await db.deleteFrom('visit_daily_statistics').where('id', '=', current.id).execute();
			continue;
		}
		await saveDailySubtraction(db, current.id, expired, remaining);
	}
	return mismatches;
}

export async function deleteExpiredDailyStatistics(
	db: Kysely<Database>,
	before: number
): Promise<void> {
	if (!Number.isSafeInteger(before) || before < -62_167_219_200_000 || before > 253_402_300_799_999)
		throw invalidStatistics();
	await db.deleteFrom('visit_daily_statistics').where('last_visit_at', '<', before).execute();
}

export async function clearDailyVisitStatistics(db: Kysely<Database>): Promise<void> {
	await db.deleteFrom('visit_daily_statistics').execute();
}

export interface LinkVisitDetails {
	period: ReportPeriod;
	links: Array<{ domain: string; path: string; details: VisitDetails }>;
}

export async function readLinkVisitDetails(
	db: Kysely<Database>,
	currentLinks: readonly { domain: string; path: string }[],
	period: ReportPeriod
): Promise<LinkVisitDetails> {
	const unique = new Map<string, Extract<ReportScope, { kind: 'link' }>>();
	for (const { domain, path } of currentLinks) {
		unique.set(JSON.stringify([domain, path]), { kind: 'link', domain, path });
	}
	const scopes = [...unique.values()];
	const details = await readCurrentDetails(db, scopes, period);
	return {
		period,
		links: scopes.map(({ domain, path }, index) => ({ domain, path, details: details[index]! }))
	};
}

export async function readVisitDetails(
	db: Kysely<Database>,
	scope: ReportScope,
	period: ReportPeriod
): Promise<VisitDetails> {
	const [details] = await readCurrentDetails(db, [scope], period);
	return details!;
}

export async function readLastVisitActivity(
	db: Kysely<Database>,
	period: ReportPeriod,
	scope: ReportScope = { kind: 'overview' }
): Promise<string | null> {
	checkReportScope(scope);
	const days = reportDays(period);
	const row = await selectedDays(db, [scope])
		.select(({ fn }) => fn.max<number>('last_visit_at').as('lastVisitAt'))
		.where('day', '>=', days.first)
		.where('day', '<=', days.last)
		.executeTakeFirstOrThrow();
	if (row.lastVisitAt === null) return null;
	if (
		!Number.isSafeInteger(row.lastVisitAt) ||
		row.lastVisitAt < -62_167_219_200_000 ||
		row.lastVisitAt > 253_402_300_799_999
	)
		throw invalidStatistics();
	const time = new Date(row.lastVisitAt).toISOString();
	if (time.slice(0, 10) < days.first || time.slice(0, 10) > days.last) throw invalidStatistics();
	return time;
}

async function readStoredDay(
	db: Kysely<Database>,
	scope: ReportScope,
	day: string
): Promise<DailyStatisticsRow | undefined> {
	return selectedDays(db, [scope]).where('day', '=', day).selectAll().executeTakeFirst();
}

async function saveDailyAddition(
	db: Kysely<Database>,
	added: DailyVisitStatistics,
	combined: DailyVisitStatistics
): Promise<void> {
	const scope = added.scope;
	await sql`
		INSERT INTO visit_daily_statistics (
			scope_kind, domain, path, day, valid_visits, invalid_visits, last_visit_at,
			browsers_json, operating_systems_json, accepted_languages_json
		) VALUES (
			${scope.kind}, ${scope.kind === 'overview' ? null : scope.domain},
			${scope.kind === 'link' ? scope.path : null}, ${added.day},
			${added.validVisits}, ${added.invalidVisits}, ${combined.lastVisitAt},
			${JSON.stringify(combined.browsers)}, ${JSON.stringify(combined.operatingSystems)},
			${JSON.stringify(combined.acceptedLanguages)}
		)
		ON CONFLICT DO UPDATE SET
			valid_visits = visit_daily_statistics.valid_visits + excluded.valid_visits,
			invalid_visits = visit_daily_statistics.invalid_visits + excluded.invalid_visits,
			last_visit_at = excluded.last_visit_at,
			browsers_json = excluded.browsers_json,
			operating_systems_json = excluded.operating_systems_json,
			accepted_languages_json = excluded.accepted_languages_json
	`.execute(db);
}

async function saveDailySubtraction(
	db: Kysely<Database>,
	id: number,
	expired: DailyVisitStatistics,
	remaining: DailyVisitStatistics
): Promise<void> {
	await db
		.updateTable('visit_daily_statistics')
		.set({
			valid_visits: sql`valid_visits - ${expired.validVisits}`,
			invalid_visits: sql`invalid_visits - ${expired.invalidVisits}`,
			last_visit_at: remaining.lastVisitAt,
			browsers_json: JSON.stringify(remaining.browsers),
			operating_systems_json: JSON.stringify(remaining.operatingSystems),
			accepted_languages_json: JSON.stringify(remaining.acceptedLanguages)
		})
		.where('id', '=', id)
		.execute();
}

function missingBucketMismatch(expired: DailyVisitStatistics): DailyStatisticsMismatch {
	return {
		scope: expired.scope,
		day: expired.day,
		rowId: null,
		reason: 'missing',
		stored: null,
		removing: { validVisits: expired.validVisits, invalidVisits: expired.invalidVisits }
	};
}

function incompatibleBucketMismatch(
	id: number,
	stored: DailyVisitStatistics,
	expired: DailyVisitStatistics
): DailyStatisticsMismatch {
	return {
		scope: expired.scope,
		day: expired.day,
		rowId: id,
		reason: 'contribution-mismatch',
		stored: { validVisits: stored.validVisits, invalidVisits: stored.invalidVisits },
		removing: { validVisits: expired.validVisits, invalidVisits: expired.invalidVisits }
	};
}

async function readCurrentDetails(
	db: Kysely<Database>,
	scopes: ReportScope[],
	period: ReportPeriod
): Promise<VisitDetails[]> {
	const days = reportDays(period);
	for (const scope of scopes) checkReportScope(scope);
	if (scopes.length === 0) return [];
	const rows = await selectedDays(db, scopes)
		.where('day', '>=', days.first)
		.where('day', '<=', days.last)
		.selectAll()
		.orderBy('day')
		.execute();
	const grouped = new Map<string, DailyVisitStatistics[]>();
	for (const row of rows) {
		const statistics = decodeDailyStatistics(row);
		const key = scopeKey(statistics.scope);
		const selected = grouped.get(key) ?? [];
		selected.push(statistics);
		grouped.set(key, selected);
	}
	return scopes.map((scope) =>
		projectVisitDetails(scope, period, grouped.get(scopeKey(scope)) ?? [])
	);
}

function reportDays(period: ReportPeriod): { first: string; last: string } {
	checkReportPeriod(period);
	const days = visitDays(period);
	return { first: days[0]!.start.slice(0, 10), last: days[days.length - 1]!.start.slice(0, 10) };
}

function decodeDailyStatistics(row: DailyStatisticsRow): DailyVisitStatistics {
	return checkDailyStatistics({
		scope: decodeStoredScope(row),
		day: row.day,
		lastVisitAt: row.last_visit_at,
		validVisits: row.valid_visits,
		invalidVisits: row.invalid_visits,
		...decodeStoredBreakdowns(row)
	});
}

function decodeStoredScope(row: DailyStatisticsRow): ReportScope {
	if (row.scope_kind === 'overview' && row.domain === null && row.path === null) {
		return { kind: 'overview' };
	}
	if (row.scope_kind === 'domain' && row.domain !== null && row.path === null) {
		return { kind: 'domain', domain: row.domain };
	}
	if (row.scope_kind === 'link' && row.domain !== null && row.path !== null) {
		return { kind: 'link', domain: row.domain, path: row.path };
	}
	throw invalidStatistics();
}

function decodeStoredBreakdowns(row: DailyStatisticsRow) {
	try {
		const browsers: unknown = JSON.parse(row.browsers_json);
		const operatingSystems: unknown = JSON.parse(row.operating_systems_json);
		const acceptedLanguages: unknown = JSON.parse(row.accepted_languages_json);
		return { browsers, operatingSystems, acceptedLanguages };
	} catch {
		throw invalidStatistics();
	}
}

function selectedDays(db: Kysely<Database>, scopes: ReportScope[]) {
	const overview = scopes.some((scope) => scope.kind === 'overview');
	const domains = scopes.flatMap((scope) => (scope.kind === 'domain' ? [scope.domain] : []));
	const links = scopes.flatMap((scope) => (scope.kind === 'link' ? [scope] : []));
	const predicates: RawBuilder<boolean>[] = [];
	if (overview) predicates.push(sql<boolean>`scope_kind = 'overview'`);
	if (domains.length > 0) {
		predicates.push(sql<boolean>`scope_kind = 'domain' AND domain IN (${sql.join(domains)})`);
	}
	if (links.length > 0) {
		predicates.push(
			sql<boolean>`scope_kind = 'link' AND (domain, path) IN (VALUES ${sql.join(links.map(({ domain, path }) => sql`(${domain}, ${path})`))})`
		);
	}
	return db.selectFrom('visit_daily_statistics').where(({ or }) => or(predicates));
}

function scopeKey(scope: ReportScope): string {
	return JSON.stringify([
		scope.kind,
		scope.kind === 'overview' ? null : scope.domain,
		scope.kind === 'link' ? scope.path : null
	]);
}

function invalidStatistics(): Error {
	return new Error('Invalid analytics report');
}
