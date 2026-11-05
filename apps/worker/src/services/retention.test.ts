import { validateConfig } from '@goto/config';
import { openDb, runMigrations, setVisitCollection } from '@goto/db';
import type { OpenWorkflow } from 'openworkflow';
import { expect, test, vi } from 'vitest';
import {
	applyRetention,
	configureRetention,
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

const visit = {
	domain: 'go.example.test',
	path: '/docs',
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
		await configureRetention(ctx, sdk);
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
		expect(
			await ctx.db.selectFrom('visit_collection').select('collect_after').executeTakeFirstOrThrow()
		).toEqual({ collect_after: null });
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
		await configureRetention(ctx, engine as unknown as OpenWorkflow);
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

test('finishes an interrupted zero-policy purge before reopening collection', async () => {
	const ctx = await context();
	try {
		const now = Date.now();
		await setVisitCollection(ctx.db, false);
		await ctx.db
			.insertInto('visits')
			.values({ ...visit, visited_at: now })
			.execute();
		ctx.config.analytics.retention_months = 9;
		await applyRetention(ctx, now);
		expect(await ctx.db.selectFrom('visits').selectAll().execute()).toEqual([]);
		const state = await ctx.db
			.selectFrom('visit_collection')
			.select('collect_after')
			.executeTakeFirstOrThrow();
		expect(state.collect_after).toBeTypeOf('number');
	} finally {
		await ctx.db.destroy();
	}
});

test('a positive job waiting for its connection cannot reopen collection after zero', async () => {
	const ctx = await context();
	const acquired = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	try {
		await setVisitCollection(ctx.db, false);
		const holding = ctx.db.transaction().execute(async () => {
			acquired.resolve();
			await release.promise;
		});
		await Promise.race([acquired.promise, holding]);
		const applying = applyRetention(ctx);
		ctx.config.analytics.retention_months = 0;
		release.resolve();
		await Promise.all([holding, applying]);
		const state = await ctx.db
			.selectFrom('visit_collection')
			.select('collect_after')
			.executeTakeFirstOrThrow();
		expect(state.collect_after).toBeNull();
	} finally {
		release.resolve();
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
