import {
	formatConfigWarnings,
	startConfigReloading,
	type PreparedConfiguration
} from '@goto/config';
import { isDeepStrictEqual } from 'node:util';
import { logger } from './logger.js';
import type { ShutdownResources } from './lifecycle.js';
import type { OpenWorkflow } from 'openworkflow';
import type { WorkerContext } from './context.js';
import { requestVisitMaintenance } from './visit-maintenance-schedule.js';

interface ConfigurationSource {
	path: string;
	initial: PreparedConfiguration;
	load(path: string): Promise<PreparedConfiguration>;
}

export async function applyConfig(
	next: PreparedConfiguration,
	previous: PreparedConfiguration,
	onApplyFailure: () => void,
	context: WorkerContext,
	engine: OpenWorkflow
): Promise<boolean> {
	await updateWorkerConfiguration(next, previous, context, engine, onApplyFailure);
	logConfigurationReload(next, previous);
	return true;
}

export async function watchConfiguration(
	source: ConfigurationSource,
	resources: ShutdownResources,
	shutdown: () => Promise<void>,
	context: WorkerContext,
	engine: OpenWorkflow
): Promise<void> {
	let watchOwned = false;
	let shutdownRequested = false;
	function shutdownAfterApplyFailure(): void {
		void shutdown().catch(() => {
			process.exitCode = 1;
			logger.error('Unable to shut down worker after configuration change');
		});
	}
	function requestShutdown(): void {
		if (shutdownRequested) return;
		shutdownRequested = true;
		if (watchOwned) shutdownAfterApplyFailure();
	}
	function reportReloadFailure(): void {
		if (shutdownRequested) return;
		logger.warn(
			'Invalid worker configuration update; previous configuration remains active until a valid update is loaded'
		);
	}
	resources.stopWatch = await startConfigReloading({
		...source,
		onChange: (next, previous) => {
			if (shutdownRequested) return false;
			return applyConfig(next, previous, requestShutdown, context, engine);
		},
		warn: (message) => logger.warn(message),
		onError: reportReloadFailure
	});
	watchOwned = true;
	if (shutdownRequested) shutdownAfterApplyFailure();
}

async function updateWorkerConfiguration(
	next: PreparedConfiguration,
	previous: PreparedConfiguration,
	context: WorkerContext,
	engine: OpenWorkflow,
	onApplyFailure: () => void
): Promise<void> {
	const months = next.configuration.analytics.retention_months;
	const retentionChanged =
		months !== previous.configuration.analytics.retention_months ||
		months !== context.config.analytics.retention_months;
	try {
		context.config = next.configuration;
		if (retentionChanged && months > 0) await requestVisitMaintenance(context, engine);
	} catch (error) {
		logger.error('Unable to apply worker configuration; stopping service');
		onApplyFailure();
		throw error;
	}
}

function logConfigurationReload(
	next: PreparedConfiguration,
	previous: PreparedConfiguration
): void {
	if (next.warnings.length > 0 && !isDeepStrictEqual(next.warnings, previous.warnings)) {
		logger.warn(formatConfigWarnings(next.warnings));
	}
	logger.info('Worker configuration reloaded');
}
