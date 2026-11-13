import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { test as base } from '@playwright/test';
import { serverEnvironment } from './environment.ts';

export { expect } from '@playwright/test';

type AppServer = {
	origin: string;
	configurationPath: string;
	logs(): string;
	stop(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

function waitForServerOrigin(child: ChildProcess): Promise<string> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('E2E startup timed out')), 30_000);
		child.once('message', (message: unknown) => {
			clearTimeout(timeout);
			if (
				typeof message !== 'object' ||
				message === null ||
				!('origin' in message) ||
				typeof message.origin !== 'string'
			) {
				reject(new Error('Invalid E2E server message'));
				return;
			}
			resolve(message.origin);
		});
		child.once('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once('exit', (code, signal) => {
			clearTimeout(timeout);
			reject(new Error(`E2E server exited (${code ?? signal})`));
		});
	});
}

async function stopServer(child: ChildProcess): Promise<void> {
	if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, 'exit');
	child.kill('SIGTERM');
	const kill = setTimeout(() => child.kill('SIGKILL'), 6_000);
	kill.unref();
	try {
		await exited;
	} finally {
		clearTimeout(kill);
	}
}

export const test = base.extend<{
	appServer: AppServer;
	withWorker: boolean;
	retentionMonths: 0 | 3 | 9 | 12;
}>({
	withWorker: [false, { option: true }],
	retentionMonths: [3, { option: true }],
	appServer: async ({ withWorker, retentionMonths }, use, testInfo) => {
		const directory = process.env.GOTO_E2E_BUILD_DIR;
		if (!directory) throw new Error('Missing E2E build directory');
		const child = fork(new URL('../server.js', import.meta.url), [], {
			env: {
				...serverEnvironment(),
				GOTO_E2E_BUILD_DIR: directory,
				GOTO_E2E_WORKER: withWorker ? '1' : '0',
				GOTO_E2E_RETENTION_MONTHS: String(retentionMonths)
			},
			execArgv: [],
			stdio: ['ignore', 'pipe', 'pipe', 'ipc']
		});
		let output = '';
		const capture = (chunk: Buffer) => {
			output = (output + chunk.toString()).slice(-50_000);
		};
		child.stdout!.on('data', capture);
		child.stderr!.on('data', capture);

		try {
			const origin = await waitForServerOrigin(child);
			const runtimeDirectory = join(directory, `runtime-${child.pid}`);
			await use({
				origin,
				configurationPath: join(runtimeDirectory, 'config/goto.yaml'),
				logs: () => output,
				async stop() {
					await stopServer(child);
					return { code: child.exitCode, signal: child.signalCode };
				}
			});
		} finally {
			await stopServer(child);
			if (testInfo.status !== testInfo.expectedStatus) {
				await testInfo.attach('server.log', { body: output, contentType: 'text/plain' });
			}
		}
	},
	baseURL: async ({ appServer }, use) => {
		await use(appServer.origin);
	}
});
