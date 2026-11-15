import { sql, type Kysely } from 'kysely';
import type { Database } from '../types.js';
import type {
	AggregatedVisitReports,
	DailyVisitCounts,
	DailyLanguageHeaderCounts,
	ReportInventory,
	DailyBrowserOsCounts
} from './types.js';

export async function aggregateVisitReports(
	db: Kysely<Database>,
	since: number,
	asOf: number,
	inventory: ReportInventory
): Promise<AggregatedVisitReports> {
	const scopes = scopedVisits(since, asOf, inventory);
	const identity = sql`scope_kind AS "scopeKind", domain, path`;
	const counts = sql`
		SUM(CASE WHEN outcome = 'valid' THEN 1 ELSE 0 END) AS "validVisits",
		SUM(CASE WHEN outcome = 'invalid' THEN 1 ELSE 0 END) AS "invalidVisits"
	`;

	return db.transaction().execute(async (transaction) => {
		const daily = await sql<DailyVisitCounts>`
			${scopes}
			SELECT ${identity}, date(visited_at / 1000.0, 'unixepoch') AS day, ${counts},
				SUM(CASE WHEN visit_path = '/' AND outcome = 'valid' THEN 1 ELSE 0 END) AS "baseValidVisits",
				SUM(CASE WHEN visit_path = '/' AND outcome = 'invalid' THEN 1 ELSE 0 END) AS "baseInvalidVisits"
			FROM scoped_visits
			GROUP BY scope_kind, domain, path, day
			ORDER BY scope_kind, domain, path, day
		`.execute(transaction);
		const browsers = await sql<DailyBrowserOsCounts>`
			${scopes}
			SELECT ${identity}, date(visited_at / 1000.0, 'unixepoch') AS day, browser AS name, ${counts}
			FROM scoped_visits
			GROUP BY scope_kind, domain, path, day, browser
			ORDER BY scope_kind, domain, path, day, name
		`.execute(transaction);
		const operatingSystems = await sql<DailyBrowserOsCounts>`
			${scopes}
			SELECT ${identity}, date(visited_at / 1000.0, 'unixepoch') AS day, os AS name, ${counts}
			FROM scoped_visits
			GROUP BY scope_kind, domain, path, day, os
			ORDER BY scope_kind, domain, path, day, name
		`.execute(transaction);
		const languageHeaders = await sql<DailyLanguageHeaderCounts>`
			${scopes}
			SELECT ${identity}, date(visited_at / 1000.0, 'unixepoch') AS day,
				accept_language AS "acceptLanguage", ${counts}
			FROM scoped_visits
			GROUP BY scope_kind, domain, path, day, accept_language
			ORDER BY scope_kind, domain, path, day, accept_language
		`.execute(transaction);
		return {
			daily: daily.rows,
			browsers: browsers.rows,
			operatingSystems: operatingSystems.rows,
			languageHeaders: languageHeaders.rows
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
			SELECT domain, path, CASE WHEN path = '/' THEN 'valid' ELSE outcome END AS outcome,
				visited_at, browser, os, accept_language
			FROM visits
			WHERE visited_at >= ${since} AND visited_at < ${asOf}
		), scoped_visits AS (
			SELECT 'overview' AS scope_kind, NULL AS domain, NULL AS path,
				path AS visit_path, outcome, visited_at, browser, os, accept_language
			FROM retained_visits
			UNION ALL
			SELECT 'domain' AS scope_kind, domain, NULL AS path,
				path AS visit_path, outcome, visited_at, browser, os, accept_language
			FROM retained_visits
			WHERE ${currentDomain}
			UNION ALL
			SELECT 'link' AS scope_kind, domain, path,
				path AS visit_path, outcome, visited_at, browser, os, accept_language
			FROM retained_visits
			WHERE ${currentLink}
		)
	`;
}
