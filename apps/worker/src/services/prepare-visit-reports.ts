import { setImmediate } from 'node:timers/promises';
import { createVisitPeriod, encodeVisitReports } from '@goto/analytics';
import { pruneVisits, purgeVisits } from '@goto/db';
import {
	aggregateVisitReports,
	clearVisitReports,
	publishVisitReports,
	type ReportInventory
} from '@goto/db/visit-reports';
import type { WorkerContext } from './context.js';
import { buildVisitReports } from './build-visit-reports.js';

export async function prepareVisitReports(
	context: WorkerContext,
	asOf = Date.now()
): Promise<void> {
	const months = context.config.analytics.retention_months;
	if (months === 0) {
		await context.db.transaction().execute(async (transaction) => {
			await clearVisitReports(transaction);
			await purgeVisits(transaction);
		});
		return;
	}

	const inventory: ReportInventory = Object.entries(context.domains).map(([domain, prepared]) => ({
		domain,
		paths: Object.keys(prepared.links)
	}));
	const period = createVisitPeriod(months, asOf);
	const since = Date.parse(period.from);
	const counts = await aggregateVisitReports(context.db, since, asOf, inventory);
	const reports = buildVisitReports(counts, inventory, period);
	const rows = encodeVisitReports(reports);
	if (context.config.analytics.retention_months !== months) return;

	// Retire old output before deleting any history represented by it.
	await clearVisitReports(context.db);
	while (context.config.analytics.retention_months === months) {
		const more = await pruneVisits(context.db, since);
		if (!more) break;
		await setImmediate();
	}
	if (context.config.analytics.retention_months !== months) return;
	await publishVisitReports(context.db, rows);
}
