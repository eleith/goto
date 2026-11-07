import type { OpenWorkflow } from 'openworkflow';
import { refreshVisitReports, reportSchedule } from '../workflows/specs.js';
import type { WorkerContext } from './context.js';

export async function configureReportSchedule(
	context: WorkerContext,
	engine: OpenWorkflow
): Promise<void> {
	await engine.scheduleWorkflow(refreshVisitReports, reportSchedule.input, reportSchedule);
	if (context.config.analytics.retention_months === 0)
		await engine.schedules.pause(reportSchedule.id);
	else await engine.schedules.resume(reportSchedule.id);
}

export async function requestReportRefresh(
	context: WorkerContext,
	engine: OpenWorkflow
): Promise<void> {
	if (context.config.analytics.retention_months === 0) {
		const visit = await context.db.selectFrom('visits').select('id').limit(1).executeTakeFirst();
		const output = await context.db
			.selectFrom('analytics_reports')
			.select('id')
			.limit(1)
			.executeTakeFirst();
		if (!visit && !output) return;
	}
	const run = await engine.runWorkflow(refreshVisitReports, {});
	await run.result();
}
