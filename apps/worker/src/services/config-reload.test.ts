import { startConfigReloading, validateConfig } from '@goto/config';
import type { OpenWorkflow } from 'openworkflow';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { applyConfig, watchConfiguration } from './config-reload.js';
import type { WorkerContext } from './context.js';
import type { ShutdownResources } from './lifecycle.js';
import { configureRetention, requestRetention } from './retention.js';

vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./retention.js', () => ({ configureRetention: vi.fn(), requestRetention: vi.fn() }));
vi.mock('@goto/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@goto/config')>()),
	startConfigReloading: vi.fn()
}));

function configuration(
	worker_path = './data/worker.sqlite',
	retention_months = 3,
	path = './data/goto.sqlite'
) {
	return validateConfig(
		{
			auth: { credentials: { username: 'test', password: 'config-test-password' } },
			database: { worker_path, path },
			analytics: { retention_months },
			domains: {}
		},
		{ env: {} }
	);
}

const engine = {} as OpenWorkflow;
function context(): WorkerContext {
	return { config: configuration().configuration, db: {} as WorkerContext['db'] };
}

beforeEach(() => {
	vi.resetAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test('requests restart for either database path and rejects the whole candidate', async () => {
	const initial = configuration();
	const restart = vi.fn();
	const ctx = context();
	const accepted = ctx.config;
	expect(await applyConfig(configuration(), initial, restart, ctx, engine)).toBe(true);
	ctx.config = accepted;
	expect(await applyConfig(configuration('./other.sqlite', 0), initial, restart, ctx, engine)).toBe(
		false
	);
	expect(
		await applyConfig(configuration(undefined, 0, './other.sqlite'), initial, restart, ctx, engine)
	).toBe(false);
	expect(restart).toHaveBeenCalledTimes(2);
	expect(ctx.config).toBe(accepted);
	expect(configureRetention).not.toHaveBeenCalled();
});

test('waits for zero-policy purge and reconciles a later re-enable', async () => {
	const ctx = context();
	const purged = Promise.withResolvers<void>();
	vi.mocked(requestRetention).mockReturnValueOnce(purged.promise);
	const disabled = configuration(undefined, 0);
	const applying = applyConfig(disabled, configuration(), vi.fn(), ctx, engine);
	await Promise.resolve();
	expect(ctx.config.analytics.retention_months).toBe(0);
	expect(requestRetention).toHaveBeenCalledExactlyOnceWith(ctx, engine);
	let accepted = false;
	void applying.then(() => {
		accepted = true;
	});
	await Promise.resolve();
	expect(accepted).toBe(false);
	purged.resolve();
	expect(await applying).toBe(true);
	expect(await applyConfig(configuration(undefined, 9), disabled, vi.fn(), ctx, engine)).toBe(true);
	expect(ctx.config.analytics.retention_months).toBe(9);
	expect(requestRetention).toHaveBeenCalledTimes(2);
});

test('reconciles positive policy changes immediately', async () => {
	const ctx = context();
	await applyConfig(configuration(), configuration(undefined, 9), vi.fn(), ctx, engine);
	expect(requestRetention).toHaveBeenCalledOnce();
	await applyConfig(configuration(undefined, 12), configuration(), vi.fn(), ctx, engine);
	expect(configureRetention).toHaveBeenCalledTimes(2);
	expect(requestRetention).toHaveBeenCalledTimes(2);
});

test('a failed policy reconciliation keeps zero effective and requests shutdown', async () => {
	const ctx = context();
	const initial = configuration();
	const failure = new Error('Private storage detail');
	vi.mocked(requestRetention).mockRejectedValueOnce(failure);
	const stop = vi.fn();
	await expect(applyConfig(configuration(undefined, 0), initial, stop, ctx, engine)).rejects.toBe(
		failure
	);
	expect(ctx.config.analytics.retention_months).toBe(0);
	expect(stop).toHaveBeenCalledOnce();
});

test('initial reread restart waits until the monitor stop handle is owned', async () => {
	vi.useFakeTimers();
	const initial = configuration();
	const stopWatch = vi.fn(async () => {});
	const resources: ShutdownResources = {};
	const shutdown = vi.fn(async () => {
		await resources.stopWatch?.();
	});
	const monitor = Promise.withResolvers<() => Promise<void>>();
	vi.mocked(startConfigReloading).mockImplementationOnce(async (options) => {
		await options.onChange(configuration('./data/new.sqlite'), initial);
		return monitor.promise;
	});
	const source = { path: '/config/goto.yaml', initial, load: async () => initial };
	const watching = watchConfiguration(source, resources, shutdown, context(), engine);
	await vi.runAllTimersAsync();
	expect(shutdown).not.toHaveBeenCalled();
	monitor.resolve(stopWatch);
	await watching;
	expect(shutdown).toHaveBeenCalledOnce();
	expect(stopWatch).toHaveBeenCalledOnce();
});
