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
	onRestart: () => void,
	context: WorkerContext,
	engine: OpenWorkflow
): Promise<boolean> {
	if (!canReloadConfiguration(next, previous, onRestart)) return false;
	await updateWorkerConfiguration(next, previous, context, engine, onRestart);
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
	let restartRequested = false;
	function shutdownForRestart(): void {
		void shutdown().catch(() => {
			process.exitCode = 1;
			logger.error('Unable to shut down worker after configuration change');
		});
	}
	function requestRestart(): void {
		if (restartRequested) return;
		restartRequested = true;
		if (watchOwned) shutdownForRestart();
	}
	function reportReloadFailure(): void {
		if (restartRequested) return;
		logger.warn(
			'Invalid worker configuration update; previous configuration remains active until a valid update is loaded'
		);
	}
	resources.stopWatch = await startConfigReloading({
		...source,
		onChange: (next, previous) => applyConfig(next, previous, requestRestart, context, engine),
		onError: reportReloadFailure
	});
	watchOwned = true;
	if (restartRequested) shutdownForRestart();
}

function canReloadConfiguration(
	next: PreparedConfiguration,
	previous: PreparedConfiguration,
	onRestart: () => void
): boolean {
	const collectVisits = next.configuration.analytics.retention_months !== 0;
	const previouslyCollectedVisits = previous.configuration.analytics.retention_months !== 0;
	if (collectVisits !== previouslyCollectedVisits) {
		logger.warn(
			'Detailed analytics change requires coordinated restart; previous configuration remains active until a valid update is loaded'
		);
		return false;
	}
	const nextDatabase = next.configuration.database;
	const previousDatabase = previous.configuration.database;
	if (
		nextDatabase.worker_path !== previousDatabase.worker_path ||
		nextDatabase.path !== previousDatabase.path
	) {
		logger.warn('Worker configuration change requires restart');
		onRestart();
		return false;
	}
	return true;
}

async function updateWorkerConfiguration(
	next: PreparedConfiguration,
	previous: PreparedConfiguration,
	context: WorkerContext,
	engine: OpenWorkflow,
	onRestart: () => void
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
		onRestart();
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
