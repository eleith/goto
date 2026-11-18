import type { ReportScope, VisitTotals } from '@goto/analytics';
import type { GotoConfiguration } from '@goto/config';
import { openDb, readVisitTotals } from '@goto/db';
import type { Immutable } from '../snapshot.js';

export async function readLifetimeVisitTotals(
	configuration: Immutable<Pick<GotoConfiguration, 'database'>>,
	scope: ReportScope
): Promise<VisitTotals | null> {
	let db: Awaited<ReturnType<typeof openDb>> | undefined;
	try {
		db = await openDb(configuration.database.path, { readOnly: true });
		return await readVisitTotals(db, scope);
	} catch {
		warnUnavailable();
		return null;
	} finally {
		await db?.destroy().catch(warnUnavailable);
	}
}

function warnUnavailable(): void {
	try {
		console.warn('Prepared lifetime visit totals unavailable');
	} catch {
		return;
	}
}
