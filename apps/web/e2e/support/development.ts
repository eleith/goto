import { fork } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { expect, type TestInfo } from '@playwright/test';

type Ready = { type: 'ready'; origin: string; directory: string };
type LifetimeEvent = { type: 'application-start' | 'application-close'; testId: string };
type Exit = { code: number | null; signal: NodeJS.Signals | null };

export async function startDevelopment(testInfo: TestInfo) {
	const child = fork(new URL('../dev-server.mjs', import.meta.url), [], {
		env: { PATH: process.env.PATH, NODE_ENV: 'development', TZ: 'UTC' },
		execArgv: [],
		stdio: ['ignore', 'pipe', 'pipe', 'ipc']
	});
	let ready: Ready | undefined;
	let exit: Exit | undefined;
	let childError: Error | undefined;
	let output = '';
	const events: LifetimeEvent[] = [];
	const live = new Set<string>();
	let peak = 0;
	const exited = new Promise<void>((resolve) => {
		child.once('exit', (code, signal) => {
			exit = { code, signal };
			resolve();
		});
	});
	child.once('error', (error) => {
		childError = error;
	});
	child.stdout!.on('data', captureOutput);
	child.stderr!.on('data', captureOutput);
	child.on('message', recordMessage);

	function captureOutput(chunk: Buffer) {
		output = (output + chunk.toString()).slice(-50_000);
	}

	function recordMessage(message: unknown) {
		if (typeof message !== 'object' || message === null || !('type' in message)) return;
		if (
			message.type === 'ready' &&
			'origin' in message &&
			typeof message.origin === 'string' &&
			'directory' in message &&
			typeof message.directory === 'string'
		) {
			ready = { type: 'ready', origin: message.origin, directory: message.directory };
		} else if (
			(message.type === 'application-start' || message.type === 'application-close') &&
			'testId' in message &&
			typeof message.testId === 'string'
		) {
			events.push({ type: message.type, testId: message.testId });
			if (message.type === 'application-start') live.add(message.testId);
			else live.delete(message.testId);
			peak = Math.max(peak, live.size);
		}
	}

	async function waitForExit(timeout: number) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				exited.then(() => true),
				new Promise<boolean>((resolve) => {
					timer = setTimeout(() => resolve(false), timeout);
				})
			]);
		} finally {
			clearTimeout(timer);
		}
	}

	async function stop() {
		if (!exit && child.connected) child.send({ type: 'shutdown' });
		else if (!exit) child.kill('SIGTERM');
		if (!(await waitForExit(10_000))) {
			throw new Error('Development server did not exit within 10 seconds');
		}
		expect(child.connected).toBe(false);
	}

	async function dispose() {
		try {
			if (child.pid && !exit) {
				child.kill('SIGTERM');
				if (!(await waitForExit(6_000))) {
					child.kill('SIGKILL');
					if (!(await waitForExit(2_000))) {
						throw new Error('Development server did not exit after SIGKILL');
					}
				}
			}
		} finally {
			try {
				await testInfo.attach('hmr-server.log', { body: output, contentType: 'text/plain' });
				await testInfo.attach('hmr-lifetime.json', {
					body: JSON.stringify({ events, peak, live: [...live], exit }),
					contentType: 'application/json'
				});
			} finally {
				if (ready) await rm(ready.directory, { recursive: true, force: true });
			}
		}
	}

	try {
		await expect
			.poll(
				() => {
					if (childError) throw childError;
					if (exit) throw new Error(`Development server exited: ${JSON.stringify(exit)}`);
					return ready;
				},
				{ timeout: 45_000 }
			)
			.toBeDefined();
		return {
			origin: ready!.origin,
			directory: ready!.directory,
			events,
			live,
			getpeak: () => peak,
			getexit: () => exit,
			stop,
			dispose
		};
	} catch (error) {
		await dispose();
		throw error;
	}
}
