import { randomInt } from 'node:crypto';
import type { OpenWorkflow } from 'openworkflow';
import type { WorkerContext } from '../services/context.js';
import { logger } from '../services/logger.js';
import { maintainVisits } from '../services/maintain-visits.js';
import { visitMaintenance, type VisitMaintenanceInput } from './specs.js';

const MAX_JITTER_SECONDS = 60;

export interface VisitMaintenanceStep {
	run<T>(config: { name: string }, fn: () => Promise<T>): Promise<T>;
	sleep(name: string, duration: `${number}s`): Promise<void>;
}

export async function runVisitMaintenance(
	context: WorkerContext,
	input: VisitMaintenanceInput,
	step: VisitMaintenanceStep
): Promise<'completed'> {
	if (input.scheduled) {
		const seconds = await step.run({ name: 'choose-jitter' }, chooseJitter);
		const duration: `${number}s` = `${seconds}s`;
		await step.sleep('retention-jitter', duration);
	}
	async function maintain(): Promise<void> {
		try {
			await maintainVisits(context);
		} catch (error) {
			logger.error('Visit maintenance failed');
			throw error;
		}
	}
	// Preserve the durable step identity used by already-queued maintenance runs.
	await step.run({ name: 'retain-visits' }, maintain);
	return 'completed';
}

export function registerVisitMaintenance(engine: OpenWorkflow, context: WorkerContext): void {
	function execute({ input, step }: { input: VisitMaintenanceInput; step: VisitMaintenanceStep }) {
		return runVisitMaintenance(context, input, step);
	}
	engine.implementWorkflow(visitMaintenance, execute);
}

async function chooseJitter(): Promise<number> {
	const upperBound = MAX_JITTER_SECONDS + 1;
	return randomInt(1, upperBound);
}
