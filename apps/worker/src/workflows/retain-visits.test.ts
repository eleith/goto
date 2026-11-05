import { validateConfig } from '@goto/config';
import { afterEach, expect, test, vi } from 'vitest';
import type { WorkerContext } from '../services/context.js';
import { applyRetention } from '../services/retention.js';
import { runRetentionWorkflow, type RetentionStep } from './retain-visits.js';

vi.mock('../services/retention.js', () => ({ applyRetention: vi.fn(async () => {}) }));

afterEach(() => vi.clearAllMocks());

function context(): WorkerContext {
	const prepared = validateConfig(
		{
			auth: { credentials: { username: 'test', password: 'jitter-test-password' } },
			domains: {}
		},
		{ env: {} }
	);
	return { config: prepared.configuration, db: {} as WorkerContext['db'] };
}

function steps() {
	const names: string[] = [];
	const sleep = vi
		.fn<(name: string, duration: string) => Promise<void>>()
		.mockResolvedValue(undefined);
	const step: RetentionStep = {
		async run(config, fn) {
			names.push(config.name);
			return fn();
		},
		sleep
	};
	return { step, names, sleep };
}

test('scheduled cleanup uses durable jitter; startup and policy runs do not', async () => {
	const ctx = context();
	const { step, names, sleep } = steps();
	await runRetentionWorkflow(ctx, { scheduled: true }, step);
	expect(names).toEqual(['choose-jitter', 'retain-visits']);
	expect(sleep).toHaveBeenCalledOnce();
	const [name, duration] = sleep.mock.calls[0]!;
	const seconds = Number(duration.slice(0, -1));
	expect(name).toBe('retention-jitter');
	expect(duration.endsWith('s')).toBe(true);
	expect(seconds).toBeGreaterThanOrEqual(1);
	expect(seconds).toBeLessThanOrEqual(60);
	expect(applyRetention).toHaveBeenCalledExactlyOnceWith(ctx);
	vi.clearAllMocks();
	names.length = 0;
	await runRetentionWorkflow(ctx, {}, step);
	expect(names).toEqual(['retain-visits']);
	expect(sleep).not.toHaveBeenCalled();
	expect(applyRetention).toHaveBeenCalledExactlyOnceWith(ctx);
});

test('a scheduled run does no cleanup if collection is disabled during its delay', async () => {
	const ctx = context();
	const { step, sleep } = steps();
	const sleeping = Promise.withResolvers<void>();
	const resumed = Promise.withResolvers<void>();
	sleep.mockImplementationOnce(async () => {
		sleeping.resolve();
		await resumed.promise;
	});
	const running = runRetentionWorkflow(ctx, { scheduled: true }, step);
	await sleeping.promise;
	ctx.config.analytics.retention_months = 0;
	resumed.resolve();
	await running;
	expect(applyRetention).not.toHaveBeenCalled();
});
