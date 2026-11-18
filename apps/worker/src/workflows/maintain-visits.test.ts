import { loadConfig } from '@goto/config';
import { afterEach, expect, test, vi } from 'vitest';
import type { WorkerContext } from '../services/context.js';
import { maintainVisits } from '../services/maintain-visits.js';
import { runVisitMaintenance, type VisitMaintenanceStep } from './maintain-visits.js';

vi.mock('../services/maintain-visits.js', () => ({
	maintainVisits: vi.fn(async () => {})
}));
afterEach(() => vi.clearAllMocks());

function context(): WorkerContext {
	const prepared = loadConfig(
		{ auth: { credentials: { username: 'test', password: 'jitter-test-password' } }, domains: {} },
		{ env: {} }
	);
	return {
		config: prepared.configuration,
		db: {} as WorkerContext['db']
	};
}
function steps() {
	const names: string[] = [];
	const sleep = vi
		.fn<(name: string, duration: string) => Promise<void>>()
		.mockResolvedValue(undefined);
	const step: VisitMaintenanceStep = {
		async run(config, fn) {
			names.push(config.name);
			return fn();
		},
		sleep
	};
	return { step, names, sleep };
}

test('scheduled maintenance keeps durable jitter while immediate cleanup is not delayed', async () => {
	const ctx = context();
	const { step, names, sleep } = steps();
	expect(await runVisitMaintenance(ctx, { scheduled: true }, step)).toBe('completed');
	expect(names).toEqual(['choose-jitter', 'retain-visits']);
	expect(sleep).toHaveBeenCalledOnce();
	const [name, duration] = sleep.mock.calls[0]!;
	const seconds = Number(duration.slice(0, -1));
	expect(name).toBe('retention-jitter');
	expect(seconds).toBeGreaterThanOrEqual(1);
	expect(seconds).toBeLessThanOrEqual(60);
	expect(maintainVisits).toHaveBeenCalledExactlyOnceWith(ctx);
	vi.clearAllMocks();
	names.length = 0;
	ctx.config.analytics.retention_months = 0;
	expect(await runVisitMaintenance(ctx, {}, step)).toBe('completed');
	expect(names).toEqual(['retain-visits']);
	expect(sleep).not.toHaveBeenCalled();
	expect(maintainVisits).toHaveBeenCalledExactlyOnceWith(ctx);
});

test('queued scheduled work does nothing when the service starts with zero retention', async () => {
	const ctx = context();
	ctx.config.analytics.retention_months = 0;
	const { step, names, sleep } = steps();
	expect(await runVisitMaintenance(ctx, { scheduled: true }, step)).toBe('completed');
	expect(names).toEqual([]);
	expect(sleep).not.toHaveBeenCalled();
	expect(maintainVisits).not.toHaveBeenCalled();
});
