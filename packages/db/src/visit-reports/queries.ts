import { sql, type Kysely } from 'kysely';
import type { Database } from '../types.js';
import {
	visitReportKey,
	type AggregatedVisitReports,
	type DailyVisitCounts,
	type ReportInventory,
	type ScopedFamilyCounts
} from './types.js';

export async function aggregateVisitReports(
	db: Kysely<Database>,
	since: number,
	asOf: number,
	inventory: ReportInventory
): Promise<AggregatedVisitReports> {
	const scopes = scopedVisits(since, asOf, inventory);
	const counts = visitCountColumns();

	return db.transaction().execute(async (transaction) => {
		const daily = await sql<DailyVisitCounts>`
			${scopes}
			SELECT scope, date(visited_at / 1000.0, 'unixepoch') AS day, ${counts}
			FROM scoped_visits
			GROUP BY scope, day
			ORDER BY scope, day
		`.execute(transaction);
		const browsers = await sql<ScopedFamilyCounts>`
			${scopes}
			SELECT scope, browser AS name, ${counts}
			FROM scoped_visits
			GROUP BY scope, browser
			ORDER BY scope, name
		`.execute(transaction);
		const operatingSystems = await sql<ScopedFamilyCounts>`
			${scopes}
			SELECT scope, os AS name, ${counts}
			FROM scoped_visits
			GROUP BY scope, os
			ORDER BY scope, name
		`.execute(transaction);

		return {
			daily: daily.rows,
			browsers: browsers.rows,
			operatingSystems: operatingSystems.rows
		};
	});
}

function scopedVisits(since: number, asOf: number, inventory: ReportInventory) {
	const domains = [...new Set(inventory.map(({ domain }) => domain))];
	const currentDomain = domains.length === 0 ? sql`0` : sql`domain IN (${sql.join(domains)})`;
	const linkRules = inventory.map(({ domain, paths }) => {
		const currentPaths = [...new Set([...paths, '/'])];
		return sql`(domain = ${domain} AND path IN (${sql.join(currentPaths)}))`;
	});
	const currentLink = linkRules.length === 0 ? sql`0` : sql.join(linkRules, sql` OR `);

	return sql`
		WITH retained_visits AS (
			SELECT domain, path, outcome, visited_at, browser, os
			FROM visits
			WHERE visited_at >= ${since} AND visited_at < ${asOf}
		), scoped_visits AS (
			SELECT ${visitReportKey()} AS scope, path, outcome, visited_at, browser, os
			FROM retained_visits
			UNION ALL
			SELECT json_array(domain) AS scope, path, outcome, visited_at, browser, os
			FROM retained_visits
			WHERE ${currentDomain}
			UNION ALL
			SELECT json_array(domain, path) AS scope, path, outcome, visited_at, browser, os
			FROM retained_visits
			WHERE ${currentLink}
		)
	`;
}

function visitCountColumns() {
	return sql`
		COUNT(*) AS total,
		SUM(CASE WHEN outcome = ${'valid'} THEN 1 ELSE 0 END) AS valid,
		SUM(CASE WHEN outcome = ${'invalid'} THEN 1 ELSE 0 END) AS invalid,
		SUM(CASE WHEN path = ${'/'} THEN 1 ELSE 0 END) AS base
	`;
}
