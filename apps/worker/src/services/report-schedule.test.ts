import { createVisitPeriod, encodeVisitReports } from '@goto/analytics';
import { loadConfig } from '@goto/config';
import { openDb, runMigrations } from '@goto/db';
import { publishVisitReports } from '@goto/db/visit-reports';
import type { OpenWorkflow } from 'openworkflow';
import { expect, test, vi } from 'vitest';
import type { WorkerContext } from './context.js';
import { buildVisitReports } from './build-visit-reports.js';
import { configureReportSchedule, requestReportRefresh } from './report-schedule.js';
import { refreshVisitReports, reportSchedule } from '../workflows/specs.js';

async function context(): Promise<WorkerContext> {
	const prepared = loadConfig(
		{
			auth: { credentials: { username: 'test', password: 'schedule-test-password' } },
			domains: {}
		},
		{ env: {} }
	);
	const db = await openDb(':memory:');
	await runMigrations(db);
	return { config: prepared.configuration, domains: prepared.domains, db };
}
function client() {
	const result = vi.fn(async () => 'completed');
	const engine = {
		scheduleWorkflow: vi.fn(async () => {}),
		schedules: { pause: vi.fn(async () => {}), resume: vi.fn(async () => {}) },
		runWorkflow: vi.fn(async () => ({ result }))
	};
	return { engine, sdk: engine as unknown as OpenWorkflow, result };
}

test('zero pauses hourly scheduling and purges prepared output even if raw history is already empty', async () => {
	const ctx = await context();
	const { engine, sdk } = client();
	try {
		ctx.config.analytics.retention_months = 0;
		await configureReportSchedule(ctx, sdk);
		expect(engine.scheduleWorkflow).toHaveBeenCalledExactlyOnceWith(
			refreshVisitReports,
			reportSchedule.input,
			reportSchedule
		);
		expect(refreshVisitReports.name).toBe('retain-visits');
		expect(reportSchedule.id).toBe('goto:retain-visits');
		expect(reportSchedule.cron).toBe('0 * * * *');
		expect(reportSchedule.timezone).toBe('UTC');
		expect(engine.schedules.pause).toHaveBeenCalledExactlyOnceWith(reportSchedule.id);
		await requestReportRefresh(ctx, sdk);
		expect(engine.runWorkflow).not.toHaveBeenCalled();
		const period = createVisitPeriod(3, Date.now());
		const reports = buildVisitReports(
			{ daily: [], browsers: [], operatingSystems: [], languageHeaders: [] },
			[],
			period
		);
		await publishVisitReports(ctx.db, encodeVisitReports(reports));
		await requestReportRefresh(ctx, sdk);
		expect(engine.runWorkflow).toHaveBeenCalledExactlyOnceWith(refreshVisitReports, {});
	} finally {
		await ctx.db.destroy();
	}
});

test('positive policy resumes scheduling and startup waits for the preparation result', async () => {
	const ctx = await context();
	const { engine, sdk, result } = client();
	try {
		await configureReportSchedule(ctx, sdk);
		expect(engine.schedules.resume).toHaveBeenCalledExactlyOnceWith(reportSchedule.id);
		const completed = Promise.withResolvers<string>();
		const requested = Promise.withResolvers<void>();
		result.mockImplementationOnce(() => {
			requested.resolve();
			return completed.promise;
		});
		let finished = false;
		const preparing = requestReportRefresh(ctx, sdk).then(() => {
			finished = true;
		});
		await requested.promise;
		expect(finished).toBe(false);
		completed.resolve('completed');
		await preparing;
		expect(finished).toBe(true);
	} finally {
		await ctx.db.destroy();
	}
});
