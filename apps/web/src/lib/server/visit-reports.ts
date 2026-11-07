import type { GotoConfiguration } from '@goto/config';
import { openDb } from '@goto/db';
import { readPreparedVisitReports, type StoredVisitReports } from '@goto/db/visit-reports';
import type { Immutable } from './snapshot.js';

type ReportConfiguration = Immutable<Pick<GotoConfiguration, 'database' | 'analytics'>>;

export async function readVisitReport(
	configuration: ReportConfiguration,
	domain?: string,
	path?: string
): Promise<StoredVisitReports | null> {
	const months = configuration.analytics.retention_months;
	if (months === 0) return null;
	let db: Awaited<ReturnType<typeof openDb>> | undefined;
	try {
		db = await openDb(configuration.database.path, { readOnly: true });
		const reports = await readPreparedVisitReports(db, domain, path);
		if (!reports || reports.period.retentionMonths !== months) return null;
		return reports;
	} catch {
		warnUnavailable();
		return null;
	} finally {
		await db?.destroy().catch(warnUnavailable);
	}
}

function warnUnavailable(): void {
	try {
		console.warn('Prepared visit reports unavailable');
	} catch {
		return;
	}
}
