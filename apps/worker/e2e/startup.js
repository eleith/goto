import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { insertVisit, openDb, runMigrations } from '@goto/db';

const visit = {
	domain: 'go.example.test',
	path: '/docs',
	outcome: 'valid',
	visited_at: Date.now(),
	ip: '127.0.0.1',
	user_agent: null,
	accept_language: null,
	browser: 'Other',
	os: 'Other'
};

async function seedHistory(directory) {
	const db = await openDb(join(directory, 'data/goto.sqlite'));
	try {
		await runMigrations(db);
		const middle = new Date();
		middle.setUTCMonth(middle.getUTCMonth() - 6);
		await insertVisit(db, { ...visit, visited_at: Date.UTC(2020, 0, 1) });
		await insertVisit(db, { ...visit, visited_at: middle.getTime() });
		await insertVisit(db, visit);
	} finally {
		await db.destroy();
	}
}

function visitCount(directory) {
	const db = new DatabaseSync(join(directory, 'data/goto.sqlite'), { readOnly: true });
	try {
		return db.prepare('SELECT count(*) AS count FROM visits').get().count;
	} finally {
		db.close();
	}
}

function lifetimeVisitCount(directory) {
	const db = new DatabaseSync(join(directory, 'data/goto.sqlite'), { readOnly: true });
	try {
		return (
			db
				.prepare(
					"SELECT valid_visits + invalid_visits AS count FROM visit_totals WHERE scope_kind = 'overview'"
				)
				.get()?.count ?? 0
		);
	} finally {
		db.close();
	}
}

function dailyVisitCount(directory) {
	const db = new DatabaseSync(join(directory, 'data/goto.sqlite'), { readOnly: true });
	try {
		return db
			.prepare(
				"SELECT coalesce(sum(valid_visits + invalid_visits), 0) AS count FROM visit_daily_statistics WHERE scope_kind = 'overview'"
			)
			.get().count;
	} finally {
		db.close();
	}
}

async function saveConfiguration(path, configuration) {
	await writeFile(`${path}.next`, JSON.stringify(configuration));
	await rename(`${path}.next`, path);
}

async function waitUntil(check, signal) {
	while (!check()) await delay(25, undefined, { signal });
}

async function checkStartup(mode, port = 0) {
	const directory = await mkdtemp(join(tmpdir(), 'goto-worker-startup-'));
	let child;
	let closed;
	let exited = false;
	let killed = false;
	let output = '';
	let message;
	let deadline;
	try {
		await mkdir(join(directory, 'config'));
		await writeFile(
			join(directory, 'config/goto.yaml'),
			JSON.stringify({
				url: { app: 'http://admin.example.test' },
				auth: { credentials: { username: 'smoke', password: 'private-worker-smoke-password' } },
				analytics: { retention_months: mode === 'retention-change' ? 9 : 0 },
				domains: {
					'go.example.test': {
						links: { '/docs': { url: 'https://example.test/docs', tags: [' work '] } }
					}
				}
			})
		);
		if (mode === 'retention-change' || mode === 'zero-accounting') await seedHistory(directory);
		if (mode === 'database-failure')
			await mkdir(join(directory, 'data/goto.sqlite'), { recursive: true });
		const source = mode === 'source';
		const entry = new URL(source ? '../src/index.ts' : '../dist/index.js', import.meta.url);
		const register = fileURLToPath(new URL('../../../tools/register.mjs', import.meta.url));
		const execArgv = source ? ['--conditions=development', '--import', register] : [];
		child = fork(entry, [], {
			cwd: directory,
			env: {
				PATH: process.env.PATH,
				NODE_ENV: source ? 'development' : 'production',
				TZ: 'UTC',
				HOST: '127.0.0.1',
				PORT: String(port),
				SHUTDOWN_TIMEOUT: '5'
			},
			execArgv,
			stdio: ['ignore', 'pipe', 'pipe', 'ipc']
		});
		child.stdout.on('data', (chunk) => {
			output = (output + chunk).slice(-50_000);
		});
		child.stderr.on('data', (chunk) => {
			output = (output + chunk).slice(-50_000);
		});
		child.once('exit', () => {
			exited = true;
		});
		closed = new Promise((resolve, reject) => {
			child.once('close', (code, signal) => resolve({ code, signal }));
			child.once('error', reject);
		});
		void closed.catch(() => {});
		child.on('message', (value) => {
			message = value;
		});
		const timedOut = new Promise((_, reject) => {
			deadline = setTimeout(() => {
				killed = true;
				child.kill('SIGKILL');
				reject(new Error('Worker smoke timed out'));
			}, 15_000);
		});
		const finished = Promise.race([closed, timedOut]);
		void finished.catch(() => {});

		if (mode === 'occupied-port' || mode === 'database-failure') {
			assert.deepEqual(await finished, { code: 1, signal: null });
			assert.equal(message, undefined, 'Failed startup announced readiness');
			assert(!output.includes('Worker service started'));
			if (mode === 'database-failure') {
				assert(output.includes('database_open_failed'));
				assert(output.includes('SQLite could not open the database'));
			} else {
				assert(output.includes('health_server_failed'));
				assert(output.includes('address or port is already in use'));
			}
			assert(!output.includes(directory), 'Startup logs must not include storage paths');
		} else {
			const readiness = new Promise((resolve, reject) => {
				child.once('message', resolve);
				child.once('error', reject);
				child.once('exit', () => reject(new Error('Worker exited before readiness')));
			});
			const ready = await Promise.race([
				readiness,
				finished.then(() => {
					throw new Error('Worker closed before readiness');
				})
			]);
			assert.equal(ready.type, 'ready');
			const response = await fetch(`http://127.0.0.1:${ready.port}/healthz`, {
				signal: AbortSignal.timeout(2000)
			});
			assert.equal(response.status, 200);
			assert.deepEqual(await response.json(), { status: 'ok' });
			const visits = visitCount(directory);
			assert.equal(visits, mode === 'retention-change' ? 2 : 0);
			assert.equal(
				lifetimeVisitCount(directory),
				mode === 'retention-change' || mode === 'zero-accounting' ? 3 : 0
			);
			const database = new DatabaseSync(join(directory, 'data/worker.sqlite'), {
				readOnly: true
			});
			try {
				const runs = database.prepare('SELECT count(*) AS count FROM workflow_runs').get().count;
				if (mode === 'retention-change' || mode === 'zero-accounting') assert(runs >= 1);
				else assert.equal(runs, 0, 'Empty zero policy needs no initial accounting run');
				const schedule = database
					.prepare('SELECT next_run_at FROM workflow_schedules WHERE id = ?')
					.get('goto:retain-visits');
				assert(schedule, 'Existing hourly maintenance identity must be registered');
				assert(schedule.next_run_at, 'Hourly visit rollup must stay active at zero');
			} finally {
				database.close();
			}
			assert.equal(dailyVisitCount(directory), mode === 'retention-change' ? 2 : 0);
			if (mode === 'storage-change') {
				const path = join(directory, 'config/goto.yaml');
				const configuration = JSON.parse(await readFile(path, 'utf8'));
				configuration.database = { worker_path: './data/restarted-worker.sqlite' };
				await saveConfiguration(path, configuration);
			} else if (mode === 'retention-change') {
				const stopped = new AbortController();
				void finished.then(
					() => stopped.abort(),
					() => stopped.abort()
				);
				const path = join(directory, 'config/goto.yaml');
				const configuration = JSON.parse(await readFile(path, 'utf8'));
				configuration.analytics.retention_months = 3;
				await saveConfiguration(path, configuration);
				await waitUntil(
					() => visitCount(directory) === 1 && dailyVisitCount(directory) === 1,
					stopped.signal
				);
				assert.equal(
					lifetimeVisitCount(directory),
					3,
					'Positive raw and daily expiry must preserve permanent visit totals'
				);
				configuration.analytics.retention_months = 0;
				await saveConfiguration(path, configuration);
				await waitUntil(
					() => output.includes('Detailed analytics change requires coordinated restart'),
					stopped.signal
				);
				assert.equal(visitCount(directory), 1, 'Live collection disable must not remove history');
				const stillRunning = await fetch(`http://127.0.0.1:${ready.port}/healthz`, {
					signal: AbortSignal.timeout(2000)
				});
				assert.equal(
					stillRunning.status,
					200,
					'Collection change must not auto-restart one service'
				);
				child.kill('SIGTERM');
			} else {
				child.kill('SIGTERM');
			}
			assert.deepEqual(await finished, { code: 0, signal: null });
			if (mode === 'storage-change') {
				assert(output.includes('Worker configuration change requires restart'));
				assert(!existsSync(join(directory, 'data/restarted-worker.sqlite')));
			}
		}
		assert.equal(killed, false, 'Worker required forced termination');
		assert(!output.includes('private-worker-smoke-password'));
	} finally {
		clearTimeout(deadline);
		if (child) {
			if (!exited) child.kill('SIGKILL');
			child.stdout?.destroy();
			child.stderr?.destroy();
			await closed?.catch(() => undefined);
		}
		await rm(directory, { recursive: true, force: true });
	}
}

await checkStartup('compiled');
await checkStartup('source');
await checkStartup('storage-change');
await checkStartup('retention-change');
await checkStartup('zero-accounting');
await checkStartup('database-failure');
const occupied = createServer();
await new Promise((resolve, reject) => {
	occupied.once('error', reject);
	occupied.listen(0, '127.0.0.1', resolve);
});
try {
	const address = occupied.address();
	assert(address && typeof address !== 'string');
	await checkStartup('occupied-port', address.port);
} finally {
	await new Promise((resolve) => occupied.close(resolve));
}
console.log(
	'Compiled/source startup, config restart, active zero-policy rollup, startup accounting before cleanup, incremental daily preparation, permanent visit totals after expiry, live positive retention, restart-only collection, health, failed database readiness, partial-startup cleanup, and shutdown passed'
);
