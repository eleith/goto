import { setImmediate } from 'node:timers/promises';
import type { GotoConfiguration } from '@goto/config';
import { pruneVisits, purgeVisits, purgeVisitsIfDisabled, setVisitCollection } from '@goto/db';
import type { OpenWorkflow } from 'openworkflow';
import { retainVisits, retentionSchedule } from '../workflows/specs.js';
import type { WorkerContext } from './context.js';

export type RetentionMonths = GotoConfiguration['analytics']['retention_months'];

export async function configureRetention(
	context: WorkerContext,
	engine: OpenWorkflow
): Promise<void> {
	const enabled = context.config.analytics.retention_months !== 0;
	if (!enabled) await setVisitCollection(context.db, false);
	await engine.scheduleWorkflow(retainVisits, retentionSchedule.input, retentionSchedule);
	if (enabled) await engine.schedules.resume(retentionSchedule.id);
	else await engine.schedules.pause(retentionSchedule.id);
}

export async function requestRetention(
	context: WorkerContext,
	engine: OpenWorkflow
): Promise<void> {
	if (context.config.analytics.retention_months === 0) {
		const visit = await context.db.selectFrom('visits').select('id').limit(1).executeTakeFirst();
		if (!visit) return;
	}
	const run = await engine.runWorkflow(retainVisits, {});
	await run.result();
}

export async function applyRetention(context: WorkerContext, now = Date.now()): Promise<void> {
	const months = context.config.analytics.retention_months;
	if (months === 0) {
		await setVisitCollection(context.db, false);
		await purgeVisits(context.db);
		return;
	}
	await context.db.transaction().execute(async (transaction) => {
		await purgeVisitsIfDisabled(transaction);
		if (context.config.analytics.retention_months !== 0) {
			await setVisitCollection(transaction, true);
		}
	});
	const before = retentionCutoff(months, now);
	while (await pruneVisits(context.db, before)) {
		await setImmediate();
	}
}

export function retentionCutoff(months: Exclude<RetentionMonths, 0>, now = Date.now()): number {
	const cutoff = new Date(now);
	const day = cutoff.getUTCDate();
	cutoff.setUTCDate(1);
	cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
	const lastDay = new Date(
		Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)
	).getUTCDate();
	cutoff.setUTCDate(Math.min(day, lastDay));
	return cutoff.getTime();
}
