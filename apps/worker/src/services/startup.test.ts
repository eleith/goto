import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { insertVisit, openDb, runMigrations } from '@goto/db';
import { Worker } from 'openworkflow';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startWorkerService } from './startup.js';

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'goto-worker-'));
	await mkdir(join(directory, 'config'));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(directory, { recursive: true, force: true });
});

async function writeConfiguration(worker_path = './state/worker.sqlite'): Promise<void> {
	const configuration = {
		site: { url: 'http://admin.example.test' },
		auth: { credentials: { username: 'test', password: 'worker-test-only-password' } },
		database: { path: './data/visits.sqlite', worker_path },
		analytics: { retention_months: 0 },
		domains: {}
	};
	await writeFile(join(directory, 'config/goto.yaml'), JSON.stringify(configuration));
}

const env = { HOST: '127.0.0.1', PORT: '0' };

test('starts an idle zero-policy service, migrates visit storage, and exposes health', async () => {
	await writeConfiguration();
	const start = vi.spyOn(Worker.prototype, 'start');
	const service = await startWorkerService({ cwd: directory, env });
	try {
		expect(start).toHaveBeenCalledOnce();
		const response = await fetch(`http://127.0.0.1:${service.port}/healthz`, {
			signal: AbortSignal.timeout(2000)
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
		const state = new DatabaseSync(join(directory, 'state/worker.sqlite'), { readOnly: true });
		try {
			expect(state.prepare('SELECT count(*) AS count FROM workflow_runs').get()?.count).toBe(0);
		} finally {
			state.close();
		}
		const db = await openDb(join(directory, 'data/visits.sqlite'), { readOnly: true });
		try {
			expect(await db.selectFrom('visits').selectAll().execute()).toEqual([]);
			expect(
				await db.selectFrom('visit_collection').select('collect_after').executeTakeFirstOrThrow()
			).toEqual({ collect_after: null });
		} finally {
			await db.destroy();
		}
	} finally {
		await service.stop();
	}
});

test('an existing zero-policy database is purged by a real startup workflow', async () => {
	await writeConfiguration();
	const path = join(directory, 'data/visits.sqlite');
	const db = await openDb(path);
	try {
		await runMigrations(db);
		await insertVisit(db, {
			domain: 'go.example.test',
			path: '/docs',
			visited_at: Date.now(),
			ip: '127.0.0.1',
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
