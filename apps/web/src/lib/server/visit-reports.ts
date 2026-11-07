import type { ReportScope, VisitSummary } from '@goto/analytics';
import type { GotoConfiguration } from '@goto/config';
import { openDb } from '@goto/db';
import { readVisitSummary as readPreparedSummary } from '@goto/db/visit-reports';
import type { Immutable } from './snapshot.js';

type ReportConfiguration = Immutable<Pick<GotoConfiguration, 'database' | 'analytics'>>;

export async function readVisitSummary(
	configuration: ReportConfiguration,
	scope: ReportScope
): Promise<VisitSummary | null> {
	const months = configuration.analytics.retention_months;
	if (months === 0) return null;
	let db: Awaited<ReturnType<typeof openDb>> | undefined;
	try {
		db = await openDb(configuration.database.path, { readOnly: true });
		const summary = await readPreparedSummary(db, scope);
		if (!summary || summary.period.retentionMonths !== months) return null;
		return summary;
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
