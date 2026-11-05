import { mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname } from 'node:path';
import { loadConfigFile, resolveConfigPath, type ConfigOptions } from '@goto/config';
import { OpenWorkflow } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import { createEngineLogger } from './engine-logger.js';
import { createHealthServer } from './health.js';
import { createShutdown, type ShutdownResources } from './lifecycle.js';
import { watchConfiguration } from './config-reload.js';
import { logger } from './logger.js';

export interface WorkerService {
	port: number;
	stop(): Promise<void>;
}

export async function startWorkerService(
	options: ConfigOptions = {},
	onRestartRequired?: () => Promise<void>
): Promise<WorkerService> {
	const captured = {
		env: { ...(options.env ?? process.env) },
		cwd: options.cwd ?? process.cwd()
	};
	const value = captured.env.PORT ?? '9000';
	const port = Number(value);
	if (!/^\d+$/.test(value) || !Number.isInteger(port) || port > 65535) {
		throw new Error('Invalid worker health port');
	}
	const path = resolveConfigPath(captured);
	const loadConfiguration = () => loadConfigFile(path, captured);
	const prepared = await loadConfiguration();
	const databasePath = prepared.configuration.database.worker_path;
	const resources: ShutdownResources = {};
	const stop = createShutdown(resources);
	try {
		await startWorkflowWorker(databasePath, resources);
		const host = captured.env.HOST ?? '0.0.0.0';
		const healthPort = await startHealthServer(host, port, resources);
		const source = { path, initial: prepared, load: loadConfiguration };
		const requestRestart = onRestartRequired ?? stop;
		await watchConfiguration(source, resources, requestRestart);
		return { port: healthPort, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}

async function startWorkflowWorker(
	databasePath: string,
	resources: ShutdownResources
): Promise<void> {
	const directory = dirname(databasePath);
	await mkdir(directory, { recursive: true });
	const backend = BackendSqlite.connect(databasePath);
	resources.backend = backend;
	const engineLogger = createEngineLogger(logger);
	const engine = new OpenWorkflow({ backend, logger: engineLogger });
	const workflowWorker = engine.newWorker();
	resources.workflowWorker = workflowWorker;
	await workflowWorker.start();
	logger.info('Workflow worker started');
}

async function startHealthServer(
	host: string,
	port: number,
	resources: ShutdownResources
): Promise<number> {
	const server = createHealthServer();
	resources.server = server;
	const listening = once(server, 'listening');
	server.listen({ host, port });
	await listening;
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Expected worker health address');
	logger.info({ port: address.port }, 'Worker health server listening');
	return address.port;
}
