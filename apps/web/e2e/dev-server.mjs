import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webDirectory = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(webDirectory, 'package.json'));
let directory;
let vite;
let ready = false;
let closing;

async function choosePort() {
	// Vite 8 treats port 0 as its default port.
	const reservation = createNetServer();
	await new Promise((resolve, reject) => {
		reservation.once('error', reject);
		reservation.listen(0, '127.0.0.1', resolve);
	});
	const address = reservation.address();
	if (!address || typeof address === 'string') throw new Error('Missing reserved port');
	await new Promise((resolve, reject) => {
		reservation.close((error) => (error ? reject(error) : resolve()));
	});
	return address.port;
}

async function prepareDependencies() {
	const sourceModules = join(webDirectory, 'node_modules');
	const modules = join(directory, 'node_modules');
	await mkdir(join(modules, '@goto'), { recursive: true });
	for (const name of await readdir(sourceModules)) {
		if (name !== '@goto') await symlink(join(sourceModules, name), join(modules, name));
	}
	for (const name of await readdir(join(sourceModules, '@goto'))) {
		if (name !== 'db') {
			await symlink(join(sourceModules, '@goto', name), join(modules, '@goto', name));
		}
	}
	const sourceDatabase = dirname(dirname(require.resolve('@goto/db/visit-worker')));
	const database = join(directory, '.packages/db');
	await mkdir(database, { recursive: true });
	for (const path of ['src', 'dist', 'package.json', 'tsconfig.json', 'tsconfig.build.json']) {
		await cp(join(sourceDatabase, path), join(database, path), { recursive: true });
	}
	await cp(join(sourceDatabase, '../../tsconfig.base.json'), join(directory, 'tsconfig.base.json'));
	await symlink(join(sourceDatabase, 'node_modules'), join(database, 'node_modules'), 'dir');
	await symlink(database, join(modules, '@goto/db'), 'dir');
}

async function prepareProject() {
	const runsDirectory = join(webDirectory, '.e2e');
	await mkdir(runsDirectory, { recursive: true });
	directory = await mkdtemp(join(runsDirectory, 'hmr-'));
	for (const path of ['src', 'server', 'package.json', 'vite.config.ts', 'tsconfig.json']) {
		await cp(join(webDirectory, path), join(directory, path), { recursive: true });
	}
	await prepareDependencies();

	const applicationPath = join(directory, 'src/lib/server/application.ts');
	const source = await readFile(applicationPath, 'utf8');
	if (source.split('return application;').length !== 2) {
		throw new Error('Expected one prepared application return for lifetime instrumentation');
	}
	await writeFile(
		applicationPath,
		`import { randomUUID as fixtureRandomUUID } from 'node:crypto';\n` +
			source.replace(
				'return application;',
				`const testId = fixtureRandomUUID();
	const timer = setInterval(() => undefined, 1000);
	const originalClose = Reflect.get(application, 'close') as (() => void | Promise<void>) | undefined;
	let closing: Promise<void> | undefined;
	process.send?.({ type: 'application-start', testId });
	return Object.assign(application, {
		testId,
		close() {
			return (closing ??= (async () => {
				await originalClose?.call(application);
				clearInterval(timer);
				process.send?.({ type: 'application-close', testId });
			})());
		}
	});`
			)
	);

	const routeDirectory = join(directory, 'src/routes/(admin)/(public)/__hmr');
	await mkdir(join(routeDirectory, 'runtime'), { recursive: true });
	await writeFile(
		join(routeDirectory, '+page.svelte'),
		`<script lang="ts">
	import { onMount } from 'svelte';
	import Revision from './Revision.svelte';

	let count = $state(0);
	let hydrated = $state(false);

	onMount(() => {
		hydrated = true;
	});
</script>

<button disabled={!hydrated} onclick={() => count += 1}>count {count}</button>
<Revision />
`
	);
	await writeFile(join(routeDirectory, 'Revision.svelte'), '<p>revision one</p>\n');
	await writeFile(
		join(routeDirectory, 'runtime/+server.ts'),
		`import type { RequestEvent } from '@sveltejs/kit';

export function GET({ locals }: RequestEvent) {
	return Response.json(
		{ testId: Reflect.get(locals.application, 'testId'), revision: 'leaf one' },
		{ headers: { 'cache-control': 'no-store' } }
	);
}
`
	);
}

async function start() {
	process.env.NODE_ENV = 'development';
	await prepareProject();
	process.chdir(directory);
	const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
	vite = await createServer({
		root: directory,
		clearScreen: false,
		server: { host: '127.0.0.1', port: await choosePort(), strictPort: true }
	});
	await vite.listen();
	const address = vite.httpServer?.address();
	if (!address || typeof address === 'string') throw new Error('Missing development address');
	const origin = `http://localhost:${address.port}`;
	await mkdir(join(directory, 'config'), { recursive: true });
	await writeFile(
		join(directory, 'config/goto.yaml'),
		JSON.stringify({
			site: { url: origin },
			auth: { credentials: { username: 'hmr-test', password: 'hmr-test-only-password' } },
			domains: {
				[`go.localhost:${address.port}`]: {
					links: { '/': { url: 'https://example.org/hmr-test' } }
				}
			}
		})
	);
	ready = true;
	process.send?.({ type: 'ready', origin, directory });
}

const startup = start();

function shutdown() {
	return (closing ??= (async () => {
		await startup.catch(() => undefined);
		try {
			await vite?.close();
		} finally {
			if (!ready && directory) await rm(directory, { recursive: true, force: true });
			if (process.connected) process.disconnect();
		}
	})().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	}));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('disconnect', shutdown);
process.on('message', (message) => {
	if (message?.type === 'shutdown') void shutdown();
});

try {
	await startup;
} catch (error) {
	console.error(error);
	process.exitCode = 1;
	await shutdown();
}
