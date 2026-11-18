import { loadConfig } from '@goto/config';
import { insertVisit, openDb, runMigrations } from '@goto/db';
import type { OpenWorkflow } from 'openworkflow';
import { expect, test, vi } from 'vitest';
import {
	configureVisitMaintenance,
	requestVisitMaintenance
} from './visit-maintenance-schedule.js';
import { visitMaintenance, visitMaintenanceSchedule } from '../workflows/specs.js';
import type { WorkerContext } from './context.js';
import { maintainVisits } from './maintain-visits.js';

function client() {
	const result = vi.fn(async () => 'completed');
	const engine = {
		scheduleWorkflow: vi.fn(async () => {}),
		schedules: { resume: vi.fn(async () => {}), pause: vi.fn(async () => {}) },
		runWorkflow: vi.fn(async () => ({ result }))
	};
	return { engine, sdk: engine as unknown as OpenWorkflow, result };
}

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
	return { config: prepared.configuration, db };
}

test('registers the existing hourly UTC schedule and always resumes operational rollup', async () => {
	const { engine, sdk } = client();
	await configureVisitMaintenance(sdk);
	expect(engine.scheduleWorkflow).toHaveBeenCalledExactlyOnceWith(
		visitMaintenance,
		visitMaintenanceSchedule.input,
		visitMaintenanceSchedule
	);
	expect(visitMaintenance.name).toBe('retain-visits');
	expect(visitMaintenanceSchedule.id).toBe('goto:retain-visits');
	expect(visitMaintenanceSchedule.cron).toBe('0 * * * *');
	expect(visitMaintenanceSchedule.timezone).toBe('UTC');
	expect(engine.schedules.resume).toHaveBeenCalledExactlyOnceWith(visitMaintenanceSchedule.id);
	expect(engine.schedules.pause).not.toHaveBeenCalled();
});

test('positive startup maintenance waits for the natural SDK result even on an empty database', async () => {
	const { engine, sdk, result } = client();
	const ctx = await context();
	try {
		const completed = Promise.withResolvers<string>();
		const requested = Promise.withResolvers<void>();
		result.mockImplementationOnce(() => {
			requested.resolve();
			return completed.promise;
		});
		let finished = false;
		const preparing = requestVisitMaintenance(ctx, sdk).then(() => {
			finished = true;
		});
		await requested.promise;
		expect(engine.runWorkflow).toHaveBeenCalledExactlyOnceWith(visitMaintenance, {});
		expect(finished).toBe(false);
		completed.resolve('completed');
		await preparing;
		expect(finished).toBe(true);
	} finally {
		await ctx.db.destroy();
	}
});

test('zero skips empty storage but requests cleanup for raw visits or daily-only output', async () => {
	const { engine, sdk, result } = client();
	const ctx = await context();
	try {
		ctx.config.analytics.retention_months = 0;
		await requestVisitMaintenance(ctx, sdk);
		expect(engine.runWorkflow).not.toHaveBeenCalled();
		await insertVisit(ctx.db, {
			domain: 'go.example.test',
			path: '/docs',
			outcome: 'valid',
			visited_at: Date.now() - 1000,
			ip: '127.0.0.1',
			user_agent: null,
			accept_language: null,
			browser: 'Other',
			os: 'Other'
		});
		await requestVisitMaintenance(ctx, sdk);
		expect(engine.runWorkflow).toHaveBeenCalledTimes(1);
		expect(result).toHaveBeenCalledTimes(1);
		ctx.config.analytics.retention_months = 3;
		await maintainVisits(ctx);
		await ctx.db.deleteFrom('visits').execute();
		ctx.config.analytics.retention_months = 0;
		await requestVisitMaintenance(ctx, sdk);
		expect(engine.runWorkflow).toHaveBeenCalledTimes(2);
		expect(result).toHaveBeenCalledTimes(2);
		await maintainVisits(ctx);
		await requestVisitMaintenance(ctx, sdk);
		expect(engine.runWorkflow).toHaveBeenCalledTimes(2);
	} finally {
		await ctx.db.destroy();
	}
});
