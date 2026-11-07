import type { Kysely } from 'kysely';
import type { Database } from '../types.js';
import {
	visitReportKey,
	type PreparedVisitReport,
	type SerializedVisitReport,
	type StoredVisitReports,
	type VisitReportPeriod
} from './types.js';

export async function clearVisitReports(db: Kysely<Database>): Promise<void> {
	await db.deleteFrom('visit_reports').execute();
}

export async function publishVisitReports(
	db: Kysely<Database>,
	period: VisitReportPeriod,
	reports: SerializedVisitReport[]
): Promise<void> {
	const rows = [{ key: 'period', data: JSON.stringify(period) }, ...reports];

	await db.transaction().execute(async (transaction) => {
		await transaction.deleteFrom('visit_reports').execute();
		await transaction.insertInto('visit_reports').values(rows).execute();
	});
}

export async function readPreparedVisitReports(
	db: Kysely<Database>,
	domain?: string,
	path?: string
): Promise<StoredVisitReports | null> {
	const reportKey = visitReportKey(domain);
	const selectionKey = visitReportKey(domain, path);
	const keys = [...new Set(['period', reportKey, selectionKey, 'empty'])];
	const rows = await db.selectFrom('visit_reports').selectAll().where('key', 'in', keys).execute();
	const dataByKey = new Map(rows.map(({ key, data }) => [key, data]));
	const periodData = dataByKey.get('period');
	const reportData = dataByKey.get(reportKey);
	if (periodData === undefined || reportData === undefined) return null;

	const report = JSON.parse(reportData) as PreparedVisitReport;
	let selection = report;
	if (selectionKey !== reportKey) {
		let selectionData = dataByKey.get(selectionKey);
		if (selectionData === undefined) {
			const linkCounts = report.linkCounts.find((link) => link.path === path)?.counts;
			if (linkCounts?.total !== 0) return null;
			selectionData = dataByKey.get('empty');
		}
		if (selectionData === undefined) return null;
		selection = JSON.parse(selectionData) as PreparedVisitReport;
	}
	return {
		period: JSON.parse(periodData) as VisitReportPeriod,
		report,
		selection
	};
}
