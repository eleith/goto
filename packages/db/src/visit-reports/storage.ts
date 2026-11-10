import {
	parseVisitDetails,
	parseVisitSummary,
	type ReportScope,
	type SerializedVisitReport,
	type VisitDetails,
	type VisitSummary
} from '@goto/analytics';
import type { Kysely } from 'kysely';
import type { Database } from '../types.js';

export async function clearVisitReports(db: Kysely<Database>): Promise<void> {
	await db.deleteFrom('analytics_reports').execute();
}

export async function publishVisitReports(
	db: Kysely<Database>,
	reports: SerializedVisitReport[]
): Promise<void> {
	const rows = reports.map(({ scope, summaryJson, detailsJson }) => {
		let domain: string | null = null;
		let path: string | null = null;
		if (scope.kind !== 'overview') domain = scope.domain;
		if (scope.kind === 'link') path = scope.path;
		return {
			scope_kind: scope.kind,
			domain,
			path,
			summary_json: summaryJson,
			details_json: detailsJson
		};
	});
	await db.transaction().execute(async (transaction) => {
		await transaction.deleteFrom('analytics_reports').execute();
		if (rows.length > 0) await transaction.insertInto('analytics_reports').values(rows).execute();
	});
}

export interface OverviewVisitDetails {
	overview: VisitDetails;
	domains: Array<{ domain: string; details: VisitDetails }>;
}

export async function readOverviewVisitDetails(
	db: Kysely<Database>,
	currentDomains: string[]
): Promise<OverviewVisitDetails | null> {
	const rows = await db
		.selectFrom('analytics_reports')
		.select(['scope_kind', 'domain', 'details_json'])
		.where(({ and, or, eb }) => {
			const overview = eb('scope_kind', '=', 'overview');
			if (currentDomains.length === 0) return overview;
			return or([
				overview,
				and([eb('scope_kind', '=', 'domain'), eb('domain', 'in', currentDomains)])
			]);
		})
		.execute();
	const overviewRow = rows.find((row) => row.scope_kind === 'overview');
	if (!overviewRow) return null;
	const overview = parseVisitDetails(overviewRow.details_json, { kind: 'overview' });
	const domains: OverviewVisitDetails['domains'] = [];
	for (const row of rows) {
		if (row.scope_kind === 'overview') continue;
		if (row.scope_kind !== 'domain' || row.domain === null) {
			throw new Error('Invalid analytics report');
		}
		const details = parseVisitDetails(
			row.details_json,
			{ kind: 'domain', domain: row.domain },
			overview.period
		);
		domains.push({ domain: row.domain, details });
	}
	return { overview, domains };
}

export interface DomainVisitDetails {
	domain: VisitDetails;
	links: Array<{ path: string; details: VisitDetails }>;
}

export async function readDomainVisitDetails(
	db: Kysely<Database>,
	domain: string,
	currentPaths: string[]
): Promise<DomainVisitDetails | null> {
	const paths = [...new Set(['/', ...currentPaths])];
	const rows = await db
		.selectFrom('analytics_reports')
		.select(['scope_kind', 'path', 'details_json'])
		.where('domain', '=', domain)
		.where(({ and, or, eb }) =>
			or([
				and([eb('scope_kind', '=', 'domain'), eb('path', 'is', null)]),
				and([eb('scope_kind', '=', 'link'), eb('path', 'in', paths)])
			])
		)
		.execute();
	const domainRow = rows.find((row) => row.scope_kind === 'domain');
	if (!domainRow) return null;
	const details = parseVisitDetails(domainRow.details_json, { kind: 'domain', domain });
	const links: DomainVisitDetails['links'] = [];
	for (const row of rows) {
		if (row.scope_kind === 'domain') continue;
		if (row.scope_kind !== 'link' || row.path === null) {
			throw new Error('Invalid analytics report');
		}
		const linkDetails = parseVisitDetails(
			row.details_json,
			{ kind: 'link', domain, path: row.path },
			details.period
		);
		links.push({ path: row.path, details: linkDetails });
	}
	return { domain: details, links };
}

export async function readVisitSummary(
	db: Kysely<Database>,
	scope: ReportScope
): Promise<VisitSummary | null> {
	const row = await reportScopeQuery(db, scope).select('summary_json').executeTakeFirst();
	return row ? parseVisitSummary(row.summary_json, scope) : null;
}

export async function readVisitDetails(
	db: Kysely<Database>,
	scope: ReportScope
): Promise<VisitDetails | null> {
	const row = await reportScopeQuery(db, scope).select('details_json').executeTakeFirst();
	return row ? parseVisitDetails(row.details_json, scope) : null;
}

function reportScopeQuery(db: Kysely<Database>, scope: ReportScope) {
	if (scope.kind === 'overview') {
		return db
			.selectFrom('analytics_reports')
			.where('scope_kind', '=', 'overview')
			.where('domain', 'is', null)
			.where('path', 'is', null);
	}
	if (scope.kind !== 'domain' && scope.kind !== 'link') {
		throw new Error('Invalid analytics report');
	}
	if (typeof scope.domain !== 'string' || scope.domain.length === 0) {
		throw new Error('Invalid analytics report');
	}
	const query = db
		.selectFrom('analytics_reports')
		.where('scope_kind', '=', scope.kind)
		.where('domain', '=', scope.domain);
	if (scope.kind === 'domain') return query.where('path', 'is', null);
	if (typeof scope.path !== 'string' || !scope.path.startsWith('/')) {
		throw new Error('Invalid analytics report');
	}
	return query.where('path', '=', scope.path);
}
