import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { emptyDailyStatistics } from '@goto/analytics';
import { ConfigError } from '@goto/config';
import * as visitDatabase from '@goto/db';
import { insertVisit, openDb, readVisitTotals, runMigrations } from '@goto/db';
import { addDailyVisitStatistics } from '@goto/db/visit-reports';
import { Worker } from 'openworkflow';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startWorkerService, type WorkerService } from './startup.js';
import { logger } from './logger.js';
import { formatWorkerStartupFailure, WorkerStartupError } from './startup-errors.js';

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'goto-worker-'));
	await mkdir(join(directory, 'config'));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(directory, { recursive: true, force: true });
});

async function writeConfiguration(
	worker_path = './state/worker.sqlite',
	tags?: string[]
): Promise<void> {
	const domains: Record<string, unknown> = {};
	if (tags !== undefined) {
		domains['go.example.test'] = {
			links: { '/docs': { url: 'https://example.test/docs', tags } }
		};
	}
	const configuration = {
		url: { app: 'http://admin.example.test' },
		auth: { credentials: { username: 'test', password: 'worker-test-only-password' } },
		database: { path: './data/visits.sqlite', worker_path },
		analytics: { retention_months: 0 },
		domains
	};
	await writeFile(join(directory, 'config/goto.yaml'), JSON.stringify(configuration));
}

const env = { HOST: '127.0.0.1', PORT: '0' };

test('zero-policy startup accounts pending visits before readiness and clears raw and daily data', async () => {
	await writeConfiguration(undefined, ['', 'work']);
	const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
	const path = join(directory, 'data/visits.sqlite');
	const db = await openDb(path);
	try {
		await runMigrations(db);
		const visitedAt = Date.now() - 1000;
		const day = new Date(visitedAt).toISOString().slice(0, 10);
		const daily = emptyDailyStatistics({ kind: 'overview' }, day);
		daily.lastVisitAt = visitedAt;
		daily.validVisits = 1;
		daily.browsers = [{ name: 'Other', validVisits: 1, invalidVisits: 0 }];
		daily.operatingSystems = [{ name: 'Other', validVisits: 1, invalidVisits: 0 }];
		daily.acceptedLanguages = [{ name: 'Other', validVisits: 1, invalidVisits: 0 }];
		await db.transaction().execute((transaction) => addDailyVisitStatistics(transaction, [daily]));
		await insertVisit(db, {
			domain: 'go.example.test',
			path: '/docs',
			outcome: 'valid',
			visited_at: visitedAt,
			ip: null,
			user_agent: null,
			accept_language: null,
			browser: 'Other',
			os: 'Other'
		});
	} finally {
		await db.destroy();
	}
	const service = await startWorkerService({ cwd: directory, env });
	try {
		expect(warning).toHaveBeenCalledWith(expect.stringContaining('/domains/*/links/*/tags/0'));
		const reader = await openDb(path, { readOnly: true });
		try {
			expect(await reader.selectFrom('visits').selectAll().execute()).toEqual([]);
			expect(await reader.selectFrom('visit_daily_statistics').select('id').execute()).toEqual([]);
			expect(await readVisitTotals(reader, { kind: 'overview' })).toEqual({
				validVisits: 1,
				invalidVisits: 0
			});
		} finally {
			await reader.destroy();
		}
	} finally {
		await service.stop();
	}
});

test('migration failure closes storage and stays primary when cleanup also fails', async () => {
	await writeConfiguration();
	const path = join(directory, 'data/visits.sqlite');
	const db = await openDb(path);
	const closeDatabase = db.destroy.bind(db);
	let service: WorkerService | undefined;
	try {
		await runMigrations(db);
		const history = new DatabaseSync(path);
		try {
			history
				.prepare('INSERT INTO kysely_migration (name, timestamp) VALUES (?, ?)')
				.run('0002_private-prelaunch-history', '2020-01-01T00:00:00.000Z');
		} finally {
			history.close();
		}
		vi.spyOn(visitDatabase, 'openDb').mockResolvedValueOnce(db);
		const cleanupFailure = Object.assign(new Error('private cleanup path and credentials'), {
			code: 'EACCES'
		});
		const destroy = vi.spyOn(db, 'destroy').mockImplementationOnce(async () => {
			await closeDatabase();
			throw cleanupFailure;
		});
		const start = vi.spyOn(Worker.prototype, 'start');
		const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
		const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
		let failure: unknown;
		try {
			service = await startWorkerService({ cwd: directory, env });
		} catch (cause) {
			failure = cause;
		}

		expect(failure).toBeInstanceOf(WorkerStartupError);
		expect(failure).toMatchObject({
			code: 'migrations_failed',
			cause: expect.any(Error)
		});
		expect(failure).toHaveProperty(
			'cause.message',
			expect.stringContaining('0002_private-prelaunch-history')
		);
		expect(failure).not.toHaveProperty('cause', cleanupFailure);
		expect(formatWorkerStartupFailure(failure)).toBe(
			'Unable to start worker service (migrations_failed): Check database migration history and the deployed build'
		);
		expect(destroy).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledExactlyOnceWith(
			'Unable to start worker service (startup_cleanup_failed): Permission denied. Check access to the configured storage directory'
		);
		expect(start).not.toHaveBeenCalled();
		expect(info).not.toHaveBeenCalled();
		expect(existsSync(join(directory, 'state/worker.sqlite'))).toBe(false);
	} finally {
		try {
			await service?.stop();
		} finally {
			await closeDatabase();
		}
	}
});

test('rejects a shared worker/visit file before opening either connection', async () => {
	await writeConfiguration('./data/visits.sqlite');
	let failure: unknown;
	try {
		await startWorkerService({ cwd: directory, env });
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(ConfigError);
	expect(failure).toHaveProperty('issues', [
		{ path: '/database/worker_path', message: 'Expected a different file from database.path' }
	]);
	expect(formatWorkerStartupFailure(failure)).toBe(
		'Unable to start worker service\n  /database/worker_path: Expected a different file from database.path'
	);
	expect(existsSync(join(directory, 'data'))).toBe(false);
});

test('invalid configuration fails before creating database storage', async () => {
	await writeFile(join(directory, 'config/goto.yaml'), 'auth: {}\ndomains: {}\n');
	await expect(startWorkerService({ cwd: directory, env: {} })).rejects.toThrow(
		'Invalid configuration'
	);
	expect(existsSync(join(directory, 'data'))).toBe(false);
});
