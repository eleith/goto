import { startConfigReloading, validateConfig } from '@goto/config';
import { afterEach, expect, test, vi } from 'vitest';
import { applyConfig, watchConfiguration } from './config-reload.js';
import type { ShutdownResources } from './lifecycle.js';

vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@goto/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@goto/config')>()),
	startConfigReloading: vi.fn()
}));

function configuration(worker_path = './data/worker.sqlite') {
	return validateConfig(
		{
			auth: { credentials: { username: 'test', password: 'config-test-password' } },
			database: { worker_path },
			domains: {}
		},
		{ env: {} }
	);
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test('accepts unchanged worker storage and requests restart for a new storage path', () => {
	const initial = configuration();
	const restart = vi.fn();
	expect(applyConfig(configuration(), initial, restart)).toBe(true);
	expect(restart).not.toHaveBeenCalled();
	expect(applyConfig(configuration('./data/other.sqlite'), initial, restart)).toBe(false);
	expect(restart).toHaveBeenCalledOnce();
});

test('initial reread restart waits until the monitor stop handle is owned', async () => {
	vi.useFakeTimers();
	const initial = configuration();
	const stopWatch = vi.fn();
	const resources: ShutdownResources = {};
	const shutdown = vi.fn(async () => {
		resources.stopWatch?.();
	});
	const monitor = Promise.withResolvers<() => void>();
	vi.mocked(startConfigReloading).mockImplementationOnce(async (options) => {
		options.onChange(configuration('./data/new.sqlite'), initial);
		return monitor.promise;
	});
	const source = { path: '/config/goto.yaml', initial, load: async () => initial };
	const watching = watchConfiguration(source, resources, shutdown);
	await vi.runAllTimersAsync();
	expect(shutdown).not.toHaveBeenCalled();
	monitor.resolve(stopWatch);
	await watching;
	expect(shutdown).toHaveBeenCalledOnce();
	expect(stopWatch).toHaveBeenCalledOnce();
});
