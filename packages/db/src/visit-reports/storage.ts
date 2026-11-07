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
