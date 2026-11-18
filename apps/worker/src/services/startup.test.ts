import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { emptyDailyStatistics } from '@goto/analytics';
import { insertVisit, openDb, readVisitTotals, runMigrations } from '@goto/db';
import { addDailyVisitStatistics } from '@goto/db/visit-reports';
import { Worker } from 'openworkflow';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startWorkerService } from './startup.js';
import { logger } from './logger.js';

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

test('starts with zero-policy rollup active, no empty run, tag warnings and healthy service', async () => {
	await writeConfiguration(undefined, ['', 'work']);
	const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
	const start = vi.spyOn(Worker.prototype, 'start');
	const service = await startWorkerService({ cwd: directory, env });
	try {
		expect(start).toHaveBeenCalledOnce();
		expect(warning).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining('/domains/*/links/*/tags/0')
		);
		const response = await fetch(`http://127.0.0.1:${service.port}/healthz`, {
			signal: AbortSignal.timeout(2000)
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
		const state = new DatabaseSync(join(directory, 'state/worker.sqlite'), { readOnly: true });
		try {
			expect(
				Number(state.prepare('SELECT count(*) AS count FROM workflow_runs').get()?.count)
			).toBe(0);
			expect(
				state
					.prepare('SELECT next_run_at FROM workflow_schedules WHERE id = ?')
					.get('goto:retain-visits')?.next_run_at
			).not.toBeNull();
		} finally {
			state.close();
		}
		const db = await openDb(join(directory, 'data/visits.sqlite'), { readOnly: true });
		try {
			expect(await db.selectFrom('visits').selectAll().execute()).toEqual([]);
			expect(await db.selectFrom('visit_daily_statistics').select('id').execute()).toEqual([]);
		} finally {
			await db.destroy();
		}
	} finally {
		await service.stop();
	}
});

test('zero-policy startup accounts pending visits before readiness and clears raw and daily data', async () => {
	await writeConfiguration(undefined, []);
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
		await db.transaction().execute(async (transaction) => {
			await transaction.deleteFrom('visit_daily_statistics').execute();
			await addDailyVisitStatistics(transaction, [daily]);
		});
		await insertVisit(db, {
			domain: 'go.example.test',
			path: '/docs',
			outcome: 'valid',
			visited_at: Date.now() - 1000,
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
		const reader = await openDb(path, { readOnly: true });
		try {
			expect(await reader.selectFrom('visits').selectAll().execute()).toEqual([]);
			expect(await reader.selectFrom('visit_daily_statistics').select('id').execute()).toEqual([]);
			expect(await readVisitTotals(reader, { kind: 'overview' })).toEqual({
				validVisits: 1,
				invalidVisits: 0
			});
			const state = new DatabaseSync(join(directory, 'state/worker.sqlite'), { readOnly: true });
			try {
				expect(
					Number(state.prepare('SELECT count(*) AS count FROM workflow_runs').get()?.count)
				).toBe(1);
				expect(
					state
						.prepare('SELECT next_run_at FROM workflow_schedules WHERE id = ?')
						.get('goto:retain-visits')?.next_run_at
				).not.toBeNull();
			} finally {
				state.close();
			}
		} finally {
			await reader.destroy();
		}
	} finally {
		await service.stop();
	}
});

test('rejects a shared worker/visit file before opening either connection', async () => {
	await writeConfiguration('./data/visits.sqlite');
	await expect(startWorkerService({ cwd: directory, env })).rejects.toThrow(
		'Worker and visit database paths must differ'
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
