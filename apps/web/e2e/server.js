import { mkdir, writeFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { insertVisit, openDb, runMigrations } from '@goto/db';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = process.env.GOTO_E2E_BUILD_DIR;
if (!directory) throw new Error('Missing E2E build directory');
const runtimeDirectory = join(directory, `runtime-${process.pid}`);
await mkdir(join(runtimeDirectory, 'config'), { recursive: true });
process.chdir(runtimeDirectory);
process.env.PROTOCOL_HEADER = 'x-forwarded-proto';
process.env.HOST = '127.0.0.1';
const reservation = createServer();
await new Promise((resolve, reject) => {
	reservation.once('error', reject);
	reservation.listen(0, '127.0.0.1', resolve);
});
const address = reservation.address();
if (!address || typeof address === 'string') throw new Error('Missing test port');
await new Promise((resolve, reject) =>
	reservation.close((error) => (error ? reject(error) : resolve()))
);
process.env.PORT = String(address.port);
const appHost = `localhost:${address.port}`;
const configuration = {
	url: { app: `http://${appHost}`, worker: 'http://goto-worker:9000' },
	auth: { credentials: { username: 'example', password: 'e2e-only-password' } },
	analytics: { retention_months: Number(process.env.GOTO_E2E_RETENTION_MONTHS ?? '3') },
	domains: {
		'go.example.org': {
			links: {
				'/schema.json': { url: 'https://example.org/public-schema' },
				'/_app/version.json': { url: 'https://example.org/public-asset' },
				'/a/b': { url: 'https://example.org/decoded' },
				'/a%2Fb': { url: 'https://example.org/literal-percent' },
				'/docs': {
					title: 'New hire handbook',
					url: 'https://example.org/first-domain',
					redirect: [
						{ if: { language: 'fr', os: 'linux' }, to: 'https://example.org/french-linux' },
						{ if: { language: 'fr' }, to: 'https://example.org/french' },
						{ if: { os: 'ios' }, to: 'https://example.org/ios' }
					],
					forward_path: true,
					forward_query: true,
					valid_from: '2020-01-01T00:00:00Z',
					valid_until: '2100-01-01T00:00:00Z',
					tags: ['work', 'docs', 'Work/100%é']
				},
				'/healthz': { url: 'https://example.org/public-health' }
			}
		},
		'tiny.example.org': {
			links: { '/docs': { url: 'https://example.org/second-domain', tags: ['Work/100%é'] } }
		}
	}
};
if (process.env.GOTO_E2E_SHARED_APP_HOST === '1') {
	configuration.domains[appHost] = {
		links: { '/docs': { url: 'https://example.org/shared-docs' } },
		fallback: { url: 'https://example.org/shared-fallback' }
	};
}
await writeFile(join(runtimeDirectory, 'config/goto.yaml'), JSON.stringify(configuration));
if (process.env.GOTO_E2E_WORKER === '1') {
	await seedVisits();
	await startWorker();
}
await import(pathToFileURL(join(directory, 'server.js')).href);

async function seedVisits() {
	const db = await openDb(join(runtimeDirectory, 'data/goto.sqlite'));
	try {
		await runMigrations(db);
		const common = {
			visited_at: Date.now() - 1000,
			ip: '203.0.113.1',
			user_agent: null,
			accept_language: null,
			browser: 'Other',
			os: 'Other'
		};
		const visits = [
			{
				domain: 'go.example.org',
				path: '/docs',
				outcome: 'valid',
				visited_at: Date.now() - 14 * 86_400_000,
				accept_language: 'fr-CA,fr,en;q=0.9,de,es,it,pt',
				browser: 'Firefox',
				os: 'Linux'
			},
			{ domain: 'go.example.org', path: '/a/b', outcome: 'invalid' },
			// Legacy Root classification exercises report normalization without rewriting raw visits.
			{ domain: 'go.example.org', path: '/', outcome: 'invalid' },
			{
				domain: 'go.example.org',
				path: '/a%2Fb',
				outcome: 'valid',
				visited_at: Date.now() - 45 * 86_400_000
			},
			{ domain: 'tiny.example.org', path: '/docs', outcome: 'valid', accept_language: 'en' }
		];
		for (const visit of visits) await insertVisit(db, { ...common, ...visit });
	} finally {
		await db.destroy();
	}
}

async function startWorker() {
	const worker = fork(new URL('../../worker/dist/index.js', import.meta.url), [], {
		cwd: runtimeDirectory,
		env: { ...process.env, HOST: '127.0.0.1', PORT: '0', SHUTDOWN_TIMEOUT: '5' },
		execArgv: [],
		stdio: ['ignore', 'inherit', 'inherit', 'ipc']
	});
	process.on('SIGTERM', () => worker.kill('SIGTERM'));
	process.on('SIGINT', () => worker.kill('SIGTERM'));
	process.on('disconnect', () => worker.kill('SIGTERM'));
	process.once('exit', () => worker.kill('SIGKILL'));
	worker.once('exit', (code, signal) => {
		if (code !== 0 || signal !== null) process.exitCode = 1;
	});
	const ready = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			worker.kill('SIGKILL');
			reject(new Error('E2E worker startup timed out'));
		}, 15_000);
		worker.once('message', (message) => {
			clearTimeout(timer);
			resolve(message);
		});
		worker.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		worker.once('exit', () => {
			clearTimeout(timer);
			reject(new Error('E2E worker exited before readiness'));
		});
	});
	if (ready.type !== 'ready') throw new Error('Invalid worker readiness');
	configuration.url.worker = `http://127.0.0.1:${ready.port}`;
	await writeFile(join(runtimeDirectory, 'config/goto.yaml'), JSON.stringify(configuration));
}
