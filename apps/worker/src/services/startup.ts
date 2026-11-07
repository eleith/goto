import { mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname } from 'node:path';
import { loadConfigFile, resolveConfigPath, type ConfigOptions } from '@goto/config';
import { openDb, runMigrations } from '@goto/db';
import { OpenWorkflow } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import { createEngineLogger } from './engine-logger.js';
import { createHealthServer } from './health.js';
import { createShutdown, type ShutdownResources } from './lifecycle.js';
import { watchConfiguration } from './config-reload.js';
import { logger } from './logger.js';
import type { WorkerContext } from './context.js';
import { configureReportSchedule, requestReportRefresh } from './report-schedule.js';
import { registerReportWorkflow } from '../workflows/refresh-visit-reports.js';

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
	const visitDatabasePath = prepared.configuration.database.path;
	if (databasePath === visitDatabasePath) {
		throw new Error('Worker and visit database paths must differ');
	}
	const resources: ShutdownResources = {};
	const stop = createShutdown(resources);
	try {
		const db = await openVisitDatabase(visitDatabasePath, resources);
		const context: WorkerContext = {
			config: prepared.configuration,
			domains: prepared.domains,
			db
		};
		const engine = await startWorkflowWorker(databasePath, context, resources);
		const host = captured.env.HOST ?? '0.0.0.0';
		const healthPort = await startHealthServer(host, port, resources);
		const source = { path, initial: prepared, load: loadConfiguration };
		const requestRestart = onRestartRequired ?? stop;
		await watchConfiguration(source, resources, requestRestart, context, engine);
		return { port: healthPort, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}

async function openVisitDatabase(
	path: string,
	resources: ShutdownResources
): Promise<WorkerContext['db']> {
	const db = await openDb(path);
	resources.db = db;
	await runMigrations(db);
	return db;
}

async function startWorkflowWorker(
	databasePath: string,
	context: WorkerContext,
	resources: ShutdownResources
): Promise<OpenWorkflow> {
	const directory = dirname(databasePath);
	await mkdir(directory, { recursive: true });
	const backend = BackendSqlite.connect(databasePath);
	resources.backend = backend;
	const engineLogger = createEngineLogger(logger);
	const engine = new OpenWorkflow({ backend, logger: engineLogger });
	registerReportWorkflow(engine, context);
	await configureReportSchedule(context, engine);
	const workflowWorker = engine.newWorker({ concurrency: 1 });
	resources.workflowWorker = workflowWorker;
	await workflowWorker.start();
	await requestReportRefresh(context, engine);
	logger.info('Workflow worker started');
	return engine;
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
