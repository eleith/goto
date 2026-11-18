import { checkReportScope, type ReportScope, type VisitTotals } from '@goto/analytics';
import { sql, type Kysely } from 'kysely';
import type { Database } from './types.js';

export async function addVisitTotals(
	db: Kysely<Database>,
	additions: readonly { scope: ReportScope; totals: VisitTotals }[]
): Promise<void> {
	if (!db.isTransaction) throw new Error('Visit totals require a writer transaction');
	for (const { scope, totals } of additions) {
		checkReportScope(scope);
		checkTotals(totals);
		if (scope.kind === 'link' && totals.invalidVisits !== 0) throw invalidTotals();
		if (totals.validVisits === 0 && totals.invalidVisits === 0) continue;
		await sql`
			INSERT INTO visit_totals (scope_kind, domain, path, valid_visits, invalid_visits)
			VALUES (
				${scope.kind}, ${scope.kind === 'overview' ? null : scope.domain},
				${scope.kind === 'link' ? scope.path : null},
				${totals.validVisits}, ${totals.invalidVisits}
			)
			ON CONFLICT DO UPDATE SET
				valid_visits = visit_totals.valid_visits + excluded.valid_visits,
				invalid_visits = visit_totals.invalid_visits + excluded.invalid_visits
		`.execute(db);
	}
}

export async function readVisitTotals(
	db: Kysely<Database>,
	scope: ReportScope
): Promise<VisitTotals> {
	checkReportScope(scope);
	const row = await db
		.selectFrom('visit_totals')
		.select(['valid_visits', 'invalid_visits'])
		.where('scope_kind', '=', scope.kind)
		.where('domain', 'is', scope.kind === 'overview' ? null : scope.domain)
		.where('path', 'is', scope.kind === 'link' ? scope.path : null)
		.executeTakeFirst();
	if (!row) return { validVisits: 0, invalidVisits: 0 };
	return checkTotals({ validVisits: row.valid_visits, invalidVisits: row.invalid_visits });
}

export async function readLinkVisitCounts(
	db: Kysely<Database>,
	links: readonly { domain: string; path: string }[]
): Promise<Array<{ domain: string; path: string; visits: number }>> {
	for (const { domain, path } of links) checkReportScope({ kind: 'link', domain, path });
	if (links.length === 0) return [];
	const { rows } = await sql<{ domain: string; path: string; visits: number }>`
		WITH requested AS (
			SELECT json_extract(value, '$.domain') AS domain, json_extract(value, '$.path') AS path
			FROM json_each(${JSON.stringify(links)})
		), pending AS (
			SELECT domain, path, count(*) AS visits FROM visits
			WHERE processed = 0 AND (outcome = 'valid' OR path = '/')
				AND (domain, path) IN (SELECT domain, path FROM requested)
			GROUP BY domain, path
		)
		SELECT requested.domain, requested.path,
			coalesce(visit_totals.valid_visits, 0) + coalesce(pending.visits, 0) AS visits
		FROM requested
		LEFT JOIN pending ON pending.domain = requested.domain AND pending.path = requested.path
		LEFT JOIN visit_totals ON visit_totals.scope_kind = 'link'
			AND visit_totals.domain = requested.domain AND visit_totals.path = requested.path
	`.execute(db);
	for (const row of rows) checkTotals({ validVisits: row.visits, invalidVisits: 0 });
	return rows;
}

function checkTotals(totals: VisitTotals): VisitTotals {
	if (
		!Number.isSafeInteger(totals.validVisits) ||
		totals.validVisits < 0 ||
		!Number.isSafeInteger(totals.invalidVisits) ||
		totals.invalidVisits < 0
	)
		throw invalidTotals();
	return totals;
}

function invalidTotals(): Error {
	return new Error('Invalid visit totals');
}
