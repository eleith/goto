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
	expect(requestVisitMaintenance).not.toHaveBeenCalled();
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
		expect(requestVisitMaintenance).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
			'Analytics collection change requires coordinated restart; keeping current configuration'
		);
	}
);

test('publishes positive retention and waits for maintenance before accepting the change', async () => {
	const initial = configuration(undefined, 9);
	const ctx = context();
	ctx.config = initial.configuration;
	const refreshed = Promise.withResolvers<void>();
	vi.mocked(requestVisitMaintenance).mockReturnValueOnce(refreshed.promise);
	const next = configuration();
	const applying = applyConfig(next, initial, vi.fn(), ctx, engine);
	await Promise.resolve();
	expect(ctx.config.analytics.retention_months).toBe(3);
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

test('failed maintenance on positive policy reconciliation requests shutdown', async () => {
	const initial = configuration(undefined, 9);
	const ctx = context();
	ctx.config = initial.configuration;
	const failure = new Error('Private storage detail');
	vi.mocked(requestVisitMaintenance).mockRejectedValueOnce(failure);
	const stop = vi.fn();
	await expect(applyConfig(configuration(), initial, stop, ctx, engine)).rejects.toBe(failure);
	expect(ctx.config.analytics.retention_months).toBe(3);
	expect(stop).toHaveBeenCalledOnce();
	expect(logger.error).toHaveBeenCalledWith(
		'Unable to apply worker configuration; stopping service'
	);
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
