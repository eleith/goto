import process from 'node:process';
import { ConfigError, formatConfigError } from '@goto/config';
import { startWorkerService, type WorkerService } from './services/startup.js';
import { logger } from './services/logger.js';

let starting: Promise<WorkerService> | undefined;
let stopping: Promise<void> | undefined;
let shutdownTimeout = 30_000;

function shutdown(): Promise<void> {
	if (stopping) return stopping;
	const deadline = setTimeout(() => process.exit(1), shutdownTimeout);
	deadline.unref();
	stopping = (async () => {
		const service = await starting?.catch(() => undefined);
		await service?.stop();
	})()
		.catch(() => {
			process.exitCode = 1;
			logger.error('Unable to shut down worker service');
		})
		.finally(() => {
			clearTimeout(deadline);
			if (process.connected) process.disconnect();
		});
	return stopping;
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('disconnect', () => void shutdown());

try {
	const value = process.env.SHUTDOWN_TIMEOUT ?? '30';
	const seconds = Number(value);
	if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(seconds) || seconds > 2_147_483.647) {
		throw new Error('Invalid worker shutdown timeout');
	}
	shutdownTimeout = seconds * 1000;
	starting = startWorkerService({}, shutdown);
	const service = await starting;
	if (stopping) {
		await stopping;
	} else {
		logger.info('Worker service started');
		if (process.send && process.connected) {
			process.send({ type: 'ready', port: service.port }, (error) => {
				if (error) void shutdown();
			});
		}
	}
} catch (error) {
	process.exitCode = 1;
	const message =
		error instanceof ConfigError
			? formatConfigError(error, 'Unable to start worker service')
			: 'Unable to start worker service';
	logger.error(message);
	await shutdown();
}
