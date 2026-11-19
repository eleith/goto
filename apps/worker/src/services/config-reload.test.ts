import { startConfigReloading, loadConfig } from '@goto/config';
import type { OpenWorkflow } from 'openworkflow';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { applyConfig, watchConfiguration } from './config-reload.js';
import type { WorkerContext } from './context.js';
import type { ShutdownResources } from './lifecycle.js';
import { logger } from './logger.js';
import { requestVisitMaintenance } from './visit-maintenance-schedule.js';

vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./visit-maintenance-schedule.js', () => ({ requestVisitMaintenance: vi.fn() }));
vi.mock('@goto/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@goto/config')>()),
	startConfigReloading: vi.fn()
}));

function configuration(
	worker_path = './data/worker.sqlite',
	retention_months = 3,
	path = './data/goto.sqlite'
) {
	return loadConfig(
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
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test('publishes the retention increase and waits for maintenance before accepting it', async () => {
	const initial = configuration();
	const ctx = context();
	ctx.config = initial.configuration;
	const refreshed = Promise.withResolvers<void>();
	vi.mocked(requestVisitMaintenance).mockReturnValueOnce(refreshed.promise);
	const next = configuration(undefined, 9);
	const applying = applyConfig(next, initial, vi.fn(), ctx, engine);
	await Promise.resolve();
	expect(ctx.config.analytics.retention_months).toBe(9);
	expect(requestVisitMaintenance).toHaveBeenCalledExactlyOnceWith(ctx, engine);
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
	expect(requestVisitMaintenance).toHaveBeenCalledTimes(2);
});

test('reconciles a positive context policy mismatch even when prepared retention is unchanged', async () => {
	const initial = configuration();
	const ctx = context();
	ctx.config.analytics.retention_months = 9;
	expect(await applyConfig(initial, initial, vi.fn(), ctx, engine)).toBe(true);
	expect(ctx.config).toBe(initial.configuration);
	expect(requestVisitMaintenance).toHaveBeenCalledExactlyOnceWith(ctx, engine);
});

test.each([0, 3])(
	'retention %s publishes inventory, destination and settings changes without database work',
	async (months) => {
		const initial = configuration(undefined, months);
		const next = loadConfig(
			{
				...initial.configuration,
				link_defaults: { forward_query: true },
				domains: {
					'go.example.test': {
						links: { '/docs': { url: 'https://example.test/new', tags: ['updated'] } }
					}
				}
			},
			{ env: {} }
		);
		const ctx = context();
		ctx.config = initial.configuration;
		const query = vi.fn(() => {
			throw new Error('Unexpected statistics database work');
		});
		ctx.db = { selectFrom: query, transaction: query } as unknown as WorkerContext['db'];
		expect(await applyConfig(next, initial, vi.fn(), ctx, engine)).toBe(true);
		expect(ctx.config).toBe(next.configuration);
		expect(query).not.toHaveBeenCalled();
		expect(requestVisitMaintenance).not.toHaveBeenCalled();
	}
);

test('publishes appearance and warning changes without maintenance', async () => {
	const initial = configuration();
	const next = {
		...loadConfig(
			{ ...initial.configuration, appearance: { primary_light_color: '#123456' } },
			{ env: {} }
		),
		warnings: [{ path: '/domains/*/links/*/tags/0', message: 'Ignored blank tag' }]
	};
	const ctx = context();
	expect(await applyConfig(next, initial, vi.fn(), ctx, engine)).toBe(true);
	expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
		'Configuration warnings\n  /domains/*/links/*/tags/0: Ignored blank tag'
	);
	expect(await applyConfig(next, next, vi.fn(), ctx, engine)).toBe(true);
	expect(logger.warn).toHaveBeenCalledOnce();
	expect(ctx.config).toBe(next.configuration);
	expect(requestVisitMaintenance).not.toHaveBeenCalled();
});

test('failed maintenance on a retention increase requests shutdown', async () => {
	const initial = configuration();
	const ctx = context();
	ctx.config = initial.configuration;
	const failure = new Error('Private storage detail');
	vi.mocked(requestVisitMaintenance).mockRejectedValueOnce(failure);
	const stop = vi.fn();
	const next = configuration(undefined, 9);
	await expect(applyConfig(next, initial, stop, ctx, engine)).rejects.toBe(failure);
	expect(ctx.config.analytics.retention_months).toBe(9);
	expect(stop).toHaveBeenCalledOnce();
	expect(logger.error).toHaveBeenCalledWith(
		'Unable to apply worker configuration; stopping service'
	);
});

test('warns that a rejected update keeps the previous configuration until corrected', async () => {
	const initial = configuration();
	const ctx = context();
	ctx.config = initial.configuration;
	const shutdown = vi.fn(async () => {});
	vi.mocked(startConfigReloading).mockResolvedValueOnce(async () => {});
	await watchConfiguration(
		{ path: '/config/goto.yaml', initial, load: async () => initial },
		{},
		shutdown,
		ctx,
		engine
	);
	const watcher = vi.mocked(startConfigReloading).mock.calls[0]![0];
	watcher.onError(new Error('Private invalid YAML input'));
	expect(ctx.config).toBe(initial.configuration);
	expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
		'Invalid worker configuration update; previous configuration remains active until a valid update is loaded'
	);
	expect(shutdown).not.toHaveBeenCalled();
	const corrected = configuration(undefined, 9);
	expect(await watcher.onChange(corrected, initial)).toBe(true);
	expect(ctx.config).toBe(corrected.configuration);
});

test('initial reread failure waits to shut down until the monitor stop handle is owned', async () => {
	vi.useFakeTimers();
	const initial = configuration();
	const stopWatch = vi.fn(async () => {});
	const resources: ShutdownResources = {};
	const shutdown = vi.fn(async () => {
		await resources.stopWatch?.();
	});
	const monitor = Promise.withResolvers<() => Promise<void>>();
	const failure = new Error('Private storage detail');
	vi.mocked(requestVisitMaintenance).mockRejectedValueOnce(failure);
	vi.mocked(startConfigReloading).mockImplementationOnce(async (options) => {
		await expect(options.onChange(configuration(undefined, 9), initial)).rejects.toBe(failure);
		options.onError(failure);
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
