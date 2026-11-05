import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('starts an empty workflow service and health server without opening visit storage', async () => {
	await writeFile(
		join(directory, 'config/goto.yaml'),
		JSON.stringify({
			site: { url: 'http://admin.example.test' },
			auth: { credentials: { username: 'test', password: 'worker-test-only-password' } },
			database: { path: './data/visits.sqlite', worker_path: './state/worker.sqlite' },
			domains: {}
		})
	);
	const start = vi.spyOn(Worker.prototype, 'start');
	const service = await startWorkerService({
		cwd: directory,
		env: { HOST: '127.0.0.1', PORT: '0' }
	});
	try {
		expect(start).toHaveBeenCalledOnce();
		const response = await fetch(`http://127.0.0.1:${service.port}/healthz`, {
			signal: AbortSignal.timeout(2000)
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
		expect(existsSync(join(directory, 'state/worker.sqlite'))).toBe(true);
		expect(existsSync(join(directory, 'data/visits.sqlite'))).toBe(false);
	} finally {
		await service.stop();
	}
});

test('invalid configuration fails before creating workflow storage', async () => {
	await writeFile(join(directory, 'config/goto.yaml'), 'auth: {}\ndomains: {}\n');
	await expect(startWorkerService({ cwd: directory, env: {} })).rejects.toThrow(
		'Invalid configuration'
	);
	expect(existsSync(join(directory, 'data'))).toBe(false);
});
