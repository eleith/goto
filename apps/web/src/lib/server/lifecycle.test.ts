import { ConfigError, validateConfig } from '@goto/config';
import { describe, expect, test, vi } from 'vitest';
import { createApplicationLifecycle } from '../../../server/lifecycle.js';
import type { Application } from './application.js';

function application(): Application {
	return validateConfig(
		{
			site: { url: 'https://admin.example.org' },
			auth: { credentials: { username: 'example', password: 'test-password' } },
			domains: {}
		},
		{ env: {} }
	);
}

describe('application lifecycle', () => {
	test('starts once for concurrent and later SSR callers', async () => {
		const loaded = Promise.withResolvers<Application>();
		const load = vi.fn(() => loaded.promise);
		const lifecycle = createApplicationLifecycle(load);
		expect(load).not.toHaveBeenCalled();
		const firstCaller = () => lifecycle.start();
		const pending = firstCaller();
		const nextCaller = () => lifecycle.start();
		const concurrent = nextCaller();
		const current = application();

		loaded.resolve(current);

		expect((await pending) === current).toBe(true);
		expect((await concurrent) === current).toBe(true);
		expect((await nextCaller()) === current).toBe(true);
		expect(load).toHaveBeenCalledOnce();
		await lifecycle.stop();
	});

	test('stop waits for a pending load and closes the resulting application', async () => {
		const loaded = Promise.withResolvers<Application>();
		const current = application();
		current.close = vi.fn();
		const load = vi.fn(() => loaded.promise);
		const lifecycle = createApplicationLifecycle(load);
		const pending = lifecycle.start();
		const stopping = lifecycle.stop();
		let stopped = false;
		const settled = stopping.then(() => {
			stopped = true;
		});

		await expect(lifecycle.start()).rejects.toThrow('Application is stopped');
		expect(stopped).toBe(false);
		expect(current.close).not.toHaveBeenCalled();

		loaded.resolve(current);
		expect((await pending) === current).toBe(true);
		await settled;

		expect(stopped).toBe(true);
		expect(current.close).toHaveBeenCalledOnce();
		expect(load).toHaveBeenCalledOnce();
	});

	test('surfaces a failed configuration load instead of returning an application', async () => {
		const load = vi.fn(async (): Promise<Application> => {
			throw new ConfigError();
		});
		const lifecycle = createApplicationLifecycle(load);

		await expect(lifecycle.start()).rejects.toThrow('Invalid configuration');
		expect(load).toHaveBeenCalledOnce();
	});

	test('stops once and blocks future starts as soon as stopping begins', async () => {
		const closeStarted = Promise.withResolvers<void>();
		const closeFinished = Promise.withResolvers<void>();
		const current = application();
		current.close = vi.fn(() => {
			closeStarted.resolve();
			return closeFinished.promise;
		});
		const load = vi.fn(async () => current);
		const lifecycle = createApplicationLifecycle(load);
		await lifecycle.start();

		const firstStop = lifecycle.stop();
		const secondStop = lifecycle.stop();
		await expect(lifecycle.start()).rejects.toThrow('Application is stopped');
		await closeStarted.promise;
		expect(current.close).toHaveBeenCalledOnce();

		closeFinished.resolve();
		await Promise.all([firstStop, secondStop]);
		await lifecycle.stop();

		expect(current.close).toHaveBeenCalledOnce();
		await expect(lifecycle.start()).rejects.toThrow('Application is stopped');
		expect(load).toHaveBeenCalledOnce();
	});

	test('stopping an unused lifecycle never loads an application', async () => {
		const load = vi.fn(async () => application());
		const lifecycle = createApplicationLifecycle(load);

		await lifecycle.stop();
		await lifecycle.stop();

		await expect(lifecycle.start()).rejects.toThrow('Application is stopped');
		expect(load).not.toHaveBeenCalled();
	});
});
