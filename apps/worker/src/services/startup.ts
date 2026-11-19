import { mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname } from 'node:path';
import {
	ConfigError,
	formatConfigWarnings,
	loadConfigFile,
	resolveConfigPath,
	type ConfigOptions
} from '@goto/config';
import { openDb, runMigrations } from '@goto/db';
import { OpenWorkflow } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import { createEngineLogger } from './engine-logger.js';
import { createHealthServer } from './health.js';
import { createShutdown, type ShutdownResources } from './lifecycle.js';
import { watchConfiguration } from './config-reload.js';
import { logger } from './logger.js';
import { formatWorkerStartupFailure, WorkerStartupError } from './startup-errors.js';
import type { WorkerContext } from './context.js';
import {
	configureVisitMaintenance,
	requestVisitMaintenance
} from './visit-maintenance-schedule.js';
import { registerVisitMaintenance } from '../workflows/maintain-visits.js';
import { warnIfDailyStatisticsMissing } from './update-daily-statistics.js';

export interface WorkerService {
	port: number;
	stop(): Promise<void>;
}

export async function startWorkerService(
	options: ConfigOptions = {},
	onReloadFailureShutdown?: () => Promise<void>
): Promise<WorkerService> {
	const captured = {
		env: { ...(options.env ?? process.env) },
		cwd: options.cwd ?? process.cwd()
	};
	const value = captured.env.PORT ?? '9000';
	const port = Number(value);
	if (!/^\d+$/.test(value) || !Number.isInteger(port) || port > 65535) {
		throw new ConfigError([{ path: '/PORT', message: 'Expected an integer between 0 and 65535' }]);
	}
	const path = resolveConfigPath(captured);
	const loadConfiguration = () => loadConfigFile(path, captured);
	const prepared = await loadConfiguration();
	if (prepared.warnings.length > 0) logger.warn(formatConfigWarnings(prepared.warnings));
	const workerDatabasePath = prepared.configuration.database.worker_path;
	const applicationDatabasePath = prepared.configuration.database.path;
	if (workerDatabasePath === applicationDatabasePath) {
		throw new ConfigError([
			{ path: '/database/worker_path', message: 'Expected a different file from database.path' }
		]);
	}
	const resources: ShutdownResources = {};
	const stop = createShutdown(resources);
	try {
		const db = await openApplicationDatabase(applicationDatabasePath, resources);
		if (prepared.configuration.analytics.retention_months > 0) {
			await checkPreparedVisitStatistics(db);
		}
		const context: WorkerContext = {
			config: prepared.configuration,
			db
		};
		const backend = await openWorkflowDatabase(workerDatabasePath, resources);
		const engine = await startWorkflowWorker(backend, context, resources);
		await prepareInitialVisitData(context, engine);
		logger.info('Workflow worker started');
		const host = captured.env.HOST ?? '0.0.0.0';
		const healthPort = await startHealthServer(host, port, resources);
		const source = { path, initial: prepared, load: loadConfiguration };
		const shutdownAfterReloadFailure = onReloadFailureShutdown ?? stop;
		try {
			await watchConfiguration(source, resources, shutdownAfterReloadFailure, context, engine);
		} catch (error) {
			throw new WorkerStartupError('config_monitor_failed', error);
		}
		return { port: healthPort, stop };
	} catch (error) {
		try {
			await stop();
		} catch (cleanupError) {
			const cleanupFailure = new WorkerStartupError('startup_cleanup_failed', cleanupError);
			const message = formatWorkerStartupFailure(cleanupFailure);
			logger.error(message);
		}
		throw error;
	}
}

async function openApplicationDatabase(
	path: string,
	resources: ShutdownResources
): Promise<WorkerContext['db']> {
	let db: WorkerContext['db'];
	try {
		db = await openDb(path);
	} catch (error) {
		throw new WorkerStartupError('database_open_failed', error);
	}
	resources.db = db;
	await applyMigrations(db);
	return db;
}

async function applyMigrations(db: WorkerContext['db']): Promise<void> {
	try {
		await runMigrations(db);
	} catch (error) {
		throw new WorkerStartupError('migrations_failed', error);
	}
}

async function checkPreparedVisitStatistics(db: WorkerContext['db']): Promise<void> {
	try {
		await warnIfDailyStatisticsMissing(db);
	} catch (error) {
		throw new WorkerStartupError('statistics_check_failed', error);
	}
}

async function openWorkflowDatabase(
	path: string,
	resources: ShutdownResources
): Promise<BackendSqlite> {
	try {
		await mkdir(dirname(path), { recursive: true });
		const backend = BackendSqlite.connect(path);
		resources.backend = backend;
		return backend;
	} catch (error) {
		throw new WorkerStartupError('workflow_database_open_failed', error);
	}
}

async function startWorkflowWorker(
	backend: BackendSqlite,
	context: WorkerContext,
	resources: ShutdownResources
): Promise<OpenWorkflow> {
	try {
		const engineLogger = createEngineLogger(logger);
		const engine = new OpenWorkflow({ backend, logger: engineLogger });
		registerVisitMaintenance(engine, context);
		await configureVisitMaintenance(engine);
		const workflowWorker = engine.newWorker({ concurrency: 1 });
		resources.workflowWorker = workflowWorker;
		await workflowWorker.start();
		return engine;
	} catch (error) {
		throw new WorkerStartupError('workflow_start_failed', error);
	}
}

async function prepareInitialVisitData(
	context: WorkerContext,
	engine: OpenWorkflow
): Promise<void> {
	try {
		await requestVisitMaintenance(context, engine);
	} catch (error) {
		throw new WorkerStartupError('startup_maintenance_failed', error);
	}
}

async function startHealthServer(
	host: string,
	port: number,
	resources: ShutdownResources
): Promise<number> {
	try {
		const server = createHealthServer();
		resources.server = server;
		const listening = once(server, 'listening');
		server.listen({ host, port });
		await listening;
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Expected worker health address');
		logger.info({ port: address.port }, 'Worker health server listening');
		return address.port;
	} catch (error) {
		throw new WorkerStartupError('health_server_failed', error);
	}
}
