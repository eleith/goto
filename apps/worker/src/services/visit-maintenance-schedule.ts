import type { OpenWorkflow } from 'openworkflow';
import { visitMaintenance, visitMaintenanceSchedule } from '../workflows/specs.js';
import type { WorkerContext } from './context.js';

export async function configureVisitMaintenance(engine: OpenWorkflow): Promise<void> {
	await engine.scheduleWorkflow(
		visitMaintenance,
		visitMaintenanceSchedule.input,
		visitMaintenanceSchedule
	);
	await engine.schedules.resume(visitMaintenanceSchedule.id);
}

export async function requestVisitMaintenance(
	context: WorkerContext,
	engine: OpenWorkflow
): Promise<void> {
	if (context.config.analytics.retention_months === 0) {
		const visit = await context.db.selectFrom('visits').select('id').limit(1).executeTakeFirst();
		const daily = await context.db
			.selectFrom('visit_daily_statistics')
			.select('id')
			.limit(1)
			.executeTakeFirst();
		if (!visit && !daily) return;
	}
	const run = await engine.runWorkflow(visitMaintenance, {});
	await run.result();
}
