import { startConfigReloading, validateConfig } from '@goto/config';
import type { OpenWorkflow } from 'openworkflow';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { applyConfig, watchConfiguration } from './config-reload.js';
import type { WorkerContext } from './context.js';
import type { ShutdownResources } from './lifecycle.js';
import { logger } from './logger.js';
import { requestReportRefresh } from './report-schedule.js';

vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./report-schedule.js', () => ({ requestReportRefresh: vi.fn() }));
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
	return { config: configuration().configuration, domains: {}, db: {} as WorkerContext['db'] };
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test('requests restart for either database path when collection remains enabled', async () => {
	const initial = configuration();
	const restart = vi.fn();
	const ctx = context();
	const accepted = ctx.config;
	expect(await applyConfig(configuration(), initial, restart, ctx, engine)).toBe(true);
	ctx.config = accepted;
	expect(await applyConfig(configuration('./other.sqlite'), initial, restart, ctx, engine)).toBe(
		false
	);
	expect(
		await applyConfig(configuration(undefined, 3, './other.sqlite'), initial, restart, ctx, engine)
	).toBe(false);
	expect(restart).toHaveBeenCalledTimes(2);
	expect(ctx.config).toBe(accepted);
	expect(requestReportRefresh).not.toHaveBeenCalled();
});

test.each([
	[3, 0],
	[0, 9]
])(
	'collection %s to %s rejects the whole candidate without auto-restart',
	async (before, after) => {
		const initial = configuration(undefined, before);
		const next = configuration('./changed-worker.sqlite', after);
		const ctx = context();
		ctx.config = initial.configuration;
		const restart = vi.fn();
		expect(await applyConfig(next, initial, restart, ctx, engine)).toBe(false);
		expect(ctx.config).toBe(initial.configuration);
		expect(restart).not.toHaveBeenCalled();
		expect(requestReportRefresh).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
			'Analytics collection change requires coordinated restart; keeping current configuration'
		);
	}
);

test('waits for refreshed reports when retention changes', async () => {
	const initial = configuration(undefined, 9);
	const ctx = context();
	ctx.config = initial.configuration;
	const refreshed = Promise.withResolvers<void>();
	vi.mocked(requestReportRefresh).mockReturnValueOnce(refreshed.promise);
	const next = configuration();
	const applying = applyConfig(next, initial, vi.fn(), ctx, engine);
	await Promise.resolve();
	expect(ctx.config.analytics.retention_months).toBe(3);
	expect(requestReportRefresh).toHaveBeenCalledExactlyOnceWith(ctx, engine);
	let accepted = false;
	void applying.then(() => {
		accepted = true;
	});
	await Promise.resolve();
	expect(accepted).toBe(false);
	refreshed.resolve();
	expect(await applying).toBe(true);
	expect(await applyConfig(configuration(undefined, 12), next, vi.fn(), ctx, engine)).toBe(true);
	expect(ctx.config.analytics.retention_months).toBe(12);
	expect(requestReportRefresh).toHaveBeenCalledTimes(2);
});

test('refreshes report inventory after an accepted domain/link change', async () => {
	const initial = configuration();
	const next = configuration();
	next.domains['go.example.test'] = {
		links: {},
		fallback: 404,
		provenance: { fallback: 'builtin' }
	};
	const ctx = context();
	expect(await applyConfig(next, initial, vi.fn(), ctx, engine)).toBe(true);
	expect(ctx.domains).toBe(next.domains);
	expect(requestReportRefresh).toHaveBeenCalledOnce();
});

test('a failed refresh on positive policy reconciliation requests shutdown', async () => {
	const initial = configuration(undefined, 9);
	const ctx = context();
	ctx.config = initial.configuration;
	const failure = new Error('Private storage detail');
	vi.mocked(requestReportRefresh).mockRejectedValueOnce(failure);
	const stop = vi.fn();
	await expect(applyConfig(configuration(), initial, stop, ctx, engine)).rejects.toBe(failure);
	expect(ctx.config.analytics.retention_months).toBe(3);
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
