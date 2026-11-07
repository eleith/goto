import { validateConfig } from '@goto/config';
import { afterEach, expect, test, vi } from 'vitest';
import type { WorkerContext } from '../services/context.js';
import { prepareVisitReports } from '../services/prepare-visit-reports.js';
import { runReportRefresh, type ReportStep } from './refresh-visit-reports.js';

vi.mock('../services/prepare-visit-reports.js', () => ({
	prepareVisitReports: vi.fn(async () => {})
}));
afterEach(() => vi.clearAllMocks());

function context(): WorkerContext {
	const prepared = validateConfig(
		{ auth: { credentials: { username: 'test', password: 'jitter-test-password' } }, domains: {} },
		{ env: {} }
	);
	return {
		config: prepared.configuration,
		domains: prepared.domains,
		db: {} as WorkerContext['db']
	};
}
function steps() {
	const names: string[] = [];
	const sleep = vi
		.fn<(name: string, duration: string) => Promise<void>>()
		.mockResolvedValue(undefined);
	const step: ReportStep = {
		async run(config, fn) {
			names.push(config.name);
			return fn();
		},
		sleep
	};
	return { step, names, sleep };
}

test('hourly refresh uses durable jitter; startup/manual refreshes do not', async () => {
	const ctx = context();
	const { step, names, sleep } = steps();
	await runReportRefresh(ctx, { scheduled: true }, step);
	expect(names).toEqual(['choose-jitter', 'retain-visits']);
	expect(sleep).toHaveBeenCalledOnce();
	const [name, duration] = sleep.mock.calls[0]!;
	const seconds = Number(duration.slice(0, -1));
	expect(name).toBe('retention-jitter');
	expect(seconds).toBeGreaterThanOrEqual(1);
	expect(seconds).toBeLessThanOrEqual(60);
	expect(prepareVisitReports).toHaveBeenCalledExactlyOnceWith(ctx);
	vi.clearAllMocks();
	names.length = 0;
	await runReportRefresh(ctx, {}, step);
	expect(names).toEqual(['retain-visits']);
	expect(sleep).not.toHaveBeenCalled();
	expect(prepareVisitReports).toHaveBeenCalledExactlyOnceWith(ctx);
});

test('old scheduled work does nothing when the service starts disabled', async () => {
	const ctx = context();
	ctx.config.analytics.retention_months = 0;
	const { step, names, sleep } = steps();
	await runReportRefresh(ctx, { scheduled: true }, step);
	expect(names).toEqual([]);
	expect(sleep).not.toHaveBeenCalled();
	expect(prepareVisitReports).not.toHaveBeenCalled();
});
