import { randomInt } from 'node:crypto';
import type { OpenWorkflow } from 'openworkflow';
import type { WorkerContext } from '../services/context.js';
import { prepareVisitReports } from '../services/prepare-visit-reports.js';
import { refreshVisitReports, type ReportRefreshInput } from './specs.js';

const MAX_JITTER_SECONDS = 60;

export interface ReportStep {
	run<T>(config: { name: string }, fn: () => Promise<T>): Promise<T>;
	sleep(name: string, duration: `${number}s`): Promise<void>;
}

export async function runReportRefresh(
	context: WorkerContext,
	input: ReportRefreshInput,
	step: ReportStep
): Promise<'completed'> {
	if (input.scheduled) {
		if (context.config.analytics.retention_months === 0) return 'completed';
		const seconds = await step.run({ name: 'choose-jitter' }, chooseJitter);
		const duration: `${number}s` = `${seconds}s`;
		await step.sleep('retention-jitter', duration);
	}
	function prepare(): Promise<void> {
		return prepareVisitReports(context);
	}
	// Preserve the durable step identity used by already-queued maintenance runs.
	await step.run({ name: 'retain-visits' }, prepare);
	return 'completed';
}

export function registerReportWorkflow(engine: OpenWorkflow, context: WorkerContext): void {
	function execute({ input, step }: { input: ReportRefreshInput; step: ReportStep }) {
		return runReportRefresh(context, input, step);
	}
	engine.implementWorkflow(refreshVisitReports, execute);
}

async function chooseJitter(): Promise<number> {
	const upperBound = MAX_JITTER_SECONDS + 1;
	return randomInt(1, upperBound);
}
