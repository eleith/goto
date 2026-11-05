import { startConfigReloading, type PreparedConfiguration } from '@goto/config';
import { logger } from './logger.js';
import type { ShutdownResources } from './lifecycle.js';

interface ConfigurationSource {
	path: string;
	initial: PreparedConfiguration;
	load(path: string): Promise<PreparedConfiguration>;
}

export function applyConfig(
	next: PreparedConfiguration,
	previous: PreparedConfiguration,
	onRestart: () => void
): boolean {
	if (next.configuration.database.worker_path !== previous.configuration.database.worker_path) {
		logger.warn('Worker configuration change requires restart');
		onRestart();
		return false;
	}
	logger.info('Worker configuration reloaded');
	return true;
}

export async function watchConfiguration(
	source: ConfigurationSource,
	resources: ShutdownResources,
	shutdown: () => Promise<void>
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
		onChange: (next, previous) => applyConfig(next, previous, requestRestart),
		onError: () =>
			logger.error('Invalid worker configuration update; keeping current configuration')
	});
	watchOwned = true;
	if (restartRequested) shutdownForRestart();
}
