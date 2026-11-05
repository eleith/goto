import { randomInt } from 'node:crypto';
import type { OpenWorkflow } from 'openworkflow';
import type { WorkerContext } from '../services/context.js';
import { applyRetention } from '../services/retention.js';
import { retainVisits, type RetainVisitsInput } from './specs.js';

const MAX_JITTER_SECONDS = 60;

export interface RetentionStep {
	run<T>(config: { name: string }, fn: () => Promise<T>): Promise<T>;
	sleep(name: string, duration: `${number}s`): Promise<void>;
}

function collectionDisabled(context: WorkerContext): boolean {
	return context.config.analytics.retention_months === 0;
}

async function chooseJitter(): Promise<number> {
	const upperBound = MAX_JITTER_SECONDS + 1;
	return randomInt(1, upperBound);
}

export async function runRetentionWorkflow(
	context: WorkerContext,
	input: RetainVisitsInput,
	step: RetentionStep
): Promise<'completed'> {
	if (input.scheduled) {
		if (collectionDisabled(context)) return 'completed';
		const seconds = await step.run({ name: 'choose-jitter' }, chooseJitter);
		const duration: `${number}s` = `${seconds}s`;
		await step.sleep('retention-jitter', duration);
	}
	function applyPolicy(): Promise<void> {
		return applyRetention(context);
	}
	await step.run({ name: 'retain-visits' }, applyPolicy);
	return 'completed';
}

export function registerRetentionWorkflow(engine: OpenWorkflow, context: WorkerContext): void {
	function execute({ input, step }: { input: RetainVisitsInput; step: RetentionStep }) {
		return runRetentionWorkflow(context, input, step);
	}
	engine.implementWorkflow(retainVisits, execute);
}
