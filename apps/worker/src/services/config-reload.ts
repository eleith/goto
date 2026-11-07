import { startConfigReloading, type PreparedConfiguration } from '@goto/config';
import { isDeepStrictEqual } from 'node:util';
import { logger } from './logger.js';
import type { ShutdownResources } from './lifecycle.js';
import type { OpenWorkflow } from 'openworkflow';
import type { WorkerContext } from './context.js';
import { requestReportRefresh } from './report-schedule.js';

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
	const months = next.configuration.analytics.retention_months;
	const previousMonths = previous.configuration.analytics.retention_months;
	const collectionEnabled = months !== 0;
	const previousCollectionEnabled = previousMonths !== 0;
	if (collectionEnabled !== previousCollectionEnabled) {
		logger.warn(
			'Analytics collection change requires coordinated restart; keeping current configuration'
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
	const currentMonths = context.config.analytics.retention_months;
	context.config = next.configuration;
	context.domains = next.domains;
	try {
		const inventoryChanged = !isDeepStrictEqual(next.domains, previous.domains);
		if (months !== previousMonths || months !== currentMonths || inventoryChanged) {
			await requestReportRefresh(context, engine);
		}
	} catch (error) {
		logger.error('Unable to apply worker retention policy; stopping service');
		onRestart();
		throw error;
	}
	logger.info('Worker configuration reloaded');
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
	resources.stopWatch = await startConfigReloading({
		...source,
		onChange: (next, previous) => applyConfig(next, previous, requestRestart, context, engine),
		onError: () =>
			logger.error('Unable to apply worker configuration update; keeping current configuration')
	});
	watchOwned = true;
	if (restartRequested) shutdownForRestart();
}
