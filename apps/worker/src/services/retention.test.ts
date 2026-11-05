import { validateConfig } from '@goto/config';
import { openDb, runMigrations, type ClassifiedVisit } from '@goto/db';
import type { OpenWorkflow } from 'openworkflow';
import { expect, test, vi } from 'vitest';
import {
	applyRetention,
	configureRetentionSchedule,
	requestRetention,
	retentionCutoff
} from './retention.js';
import type { WorkerContext } from './context.js';
import { retainVisits, retentionSchedule } from '../workflows/specs.js';

test('uses UTC calendar months, clamping the day while preserving the time', () => {
	const now = Date.parse('2026-05-31T12:34:56.789Z');
	expect(new Date(retentionCutoff(3, now)).toISOString()).toBe('2026-02-28T12:34:56.789Z');
	expect(new Date(retentionCutoff(9, now)).toISOString()).toBe('2025-08-31T12:34:56.789Z');
	expect(new Date(retentionCutoff(12, now)).toISOString()).toBe('2025-05-31T12:34:56.789Z');
});

async function context(): Promise<WorkerContext> {
	const db = await openDb(':memory:');
	await runMigrations(db);
	const { configuration: config } = validateConfig(
		{
			auth: { credentials: { username: 'test', password: 'retention-test-password' } },
			domains: {}
		},
		{ env: {} }
	);
	return { db, config };
}

function client() {
	const result = vi.fn(async () => 'completed');
	const engine = {
		scheduleWorkflow: vi.fn(async () => {}),
		schedules: { pause: vi.fn(async () => {}), resume: vi.fn(async () => {}) },
		runWorkflow: vi.fn(async () => ({ result }))
	};
	return { engine, result };
}

const visit: ClassifiedVisit = {
	domain: 'go.example.test',
	path: '/docs',
	outcome: 'valid',
	visited_at: 1,
	ip: '127.0.0.1',
	user_agent: null,
	accept_language: null,
	browser: 'Other',
	os: 'Other'
};

test('zero pauses the native schedule and queues one purge only when data exists', async () => {
	const ctx = await context();
	const { engine, result } = client();
	const sdk = engine as unknown as OpenWorkflow;
	try {
		ctx.config.analytics.retention_months = 0;
		await configureRetentionSchedule(ctx, sdk);
		expect(engine.scheduleWorkflow).toHaveBeenCalledExactlyOnceWith(
			retainVisits,
			retentionSchedule.input,
			retentionSchedule
		);
		expect(engine.schedules.pause).toHaveBeenCalledExactlyOnceWith(retentionSchedule.id);
		expect(engine.schedules.resume).not.toHaveBeenCalled();
		await requestRetention(ctx, sdk);
		expect(engine.runWorkflow).not.toHaveBeenCalled();
		await ctx.db.insertInto('visits').values(visit).execute();
		const completed = Promise.withResolvers<string>();
		const requested = Promise.withResolvers<void>();
		result.mockImplementationOnce(() => {
			requested.resolve();
			return completed.promise;
		});
		const requesting = requestRetention(ctx, sdk);
		await requested.promise;
		let finished = false;
		void requesting.then(() => {
			finished = true;
		});
		await Promise.resolve();
		expect(finished).toBe(false);
		completed.resolve('completed');
		await requesting;
		expect(engine.runWorkflow).toHaveBeenCalledExactlyOnceWith(retainVisits, {});
		await applyRetention(ctx);
		expect(await ctx.db.selectFrom('visits').selectAll().execute()).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});

test('positive retention resumes the schedule and prunes every expired batch using one cutoff', async () => {
	const ctx = await context();
	const { engine } = client();
	try {
		const now = Date.parse('2026-05-31T12:34:56.789Z');
		const cutoff = retentionCutoff(3, now);
		await ctx.db
			.insertInto('visits')
			.values([
				...Array.from({ length: 1001 }, () => ({ ...visit, visited_at: cutoff - 1 })),
				{ ...visit, visited_at: cutoff }
			])
			.execute();
		await configureRetentionSchedule(ctx, engine as unknown as OpenWorkflow);
		expect(engine.schedules.resume).toHaveBeenCalledExactlyOnceWith(retentionSchedule.id);
		expect(engine.schedules.pause).not.toHaveBeenCalled();
		await applyRetention(ctx, now);
		expect(await ctx.db.selectFrom('visits').select('visited_at').execute()).toEqual([
			{ visited_at: cutoff }
		]);
	} finally {
		await ctx.db.destroy();
	}
});

test('handles leap-day boundaries without overflowing into March', () => {
	expect(new Date(retentionCutoff(3, Date.parse('2024-05-31T01:00:00Z'))).toISOString()).toBe(
		'2024-02-29T01:00:00.000Z'
	);
	expect(new Date(retentionCutoff(12, Date.parse('2024-02-29T01:00:00Z'))).toISOString()).toBe(
		'2023-02-28T01:00:00.000Z'
	);
});
