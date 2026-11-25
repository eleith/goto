import { createVisitPeriod, type ReportScope, type VisitTotals } from '@goto/analytics';
import { loadConfig } from '@goto/config';
import {
	openDb,
	runMigrations,
	insertVisit,
	processVisitBatch,
	deleteExpiredVisitBatch,
	deleteProcessedVisitBatch,
	readVisitTotals,
	type ClassifiedVisit
} from '@goto/db';
import { readVisitDetails } from '@goto/db/visit-reports';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test, vi } from 'vitest';
import { maintainVisits } from './maintain-visits.js';
import { addDailyStatistics, warnIfDailyStatisticsMissing } from './update-daily-statistics.js';
import { logger } from './logger.js';
import { getVisitFacts } from './visit-facts.js';
import type { WorkerContext } from './context.js';

vi.mock('@goto/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@goto/db')>();
	return {
		...actual,
		processVisitBatch: vi.fn(actual.processVisitBatch),
		deleteExpiredVisitBatch: vi.fn(actual.deleteExpiredVisitBatch),
		deleteProcessedVisitBatch: vi.fn(actual.deleteProcessedVisitBatch)
	};
});

vi.mock('./update-daily-statistics.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./update-daily-statistics.js')>();
	return { ...actual, addDailyStatistics: vi.fn(actual.addDailyStatistics) };
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(processVisitBatch).mockReset();
	vi.mocked(deleteExpiredVisitBatch).mockReset();
	vi.mocked(deleteProcessedVisitBatch).mockReset();
	vi.mocked(addDailyStatistics).mockReset();
});

async function context(): Promise<WorkerContext> {
	const prepared = loadConfig(
		{
			auth: { credentials: { username: 'test', password: 'maintenance-test-password' } },
			domains: { 'go.example.test': { links: { '/docs': { url: 'https://example.test/docs' } } } }
		},
		{ env: {} }
	);
	const db = await openDb(':memory:');
	await runMigrations(db);
	return { config: prepared.configuration, db };
}
const visit: ClassifiedVisit = {
	domain: 'go.example.test',
	path: '/docs',
	outcome: 'valid',
	visited_at: 1,
	ip: '127.0.0.1',
	user_agent: null,
	accept_language: null,
	browser: 'Firefox',
	os: 'Linux'
};
const overview = { kind: 'overview' as const };
const domain = { kind: 'domain' as const, domain: 'go.example.test' };
const docs = { kind: 'link' as const, domain: 'go.example.test', path: '/docs' };
const root = { ...docs, path: '/' };
const reportNow = Date.parse('2026-05-31T12:00:00Z');
const period = createVisitPeriod(3, reportNow);

async function readTotals(db: WorkerContext['db'], scope: ReportScope): Promise<VisitTotals> {
	const details = await readVisitDetails(db, scope, period);
	return details.daily.reduce(
		(total, row) => ({
			validVisits: total.validVisits + row.validVisits,
			invalidVisits: total.invalidVisits + row.invalidVisits
		}),
		{ validVisits: 0, invalidVisits: 0 }
	);
}

test('expires invalid clicks from their path report without adding to lifetime link hits', async () => {
	const ctx = await context();
	try {
		const cutoff = Date.parse(period.from);
		const invalidVisit = { ...visit, outcome: 'invalid' as const };
		await insertVisit(ctx.db, { ...invalidVisit, visited_at: cutoff - 1 });
		await insertVisit(ctx.db, { ...invalidVisit, visited_at: cutoff });

		await maintainVisits(ctx, reportNow);

		expect(await readTotals(ctx.db, docs)).toEqual({ validVisits: 0, invalidVisits: 1 });
		expect(await readVisitTotals(ctx.db, docs)).toEqual({ validVisits: 0, invalidVisits: 0 });
	} finally {
		await ctx.db.destroy();
	}
});

test('accounts visits once across a batch boundary and keeps the cutoff-day survivor', async () => {
	const ctx = await context();
	try {
		const now = reportNow;
		const cutoff = Date.parse(period.from);
		await ctx.db
			.insertInto('visits')
			.values(
				Array.from({ length: 1001 }, () => ({ ...visit, visited_at: cutoff - 1, processed: 0 }))
			)
			.execute();
		await insertVisit(ctx.db, {
			...visit,
			visited_at: cutoff,
			accept_language: 'fr-CA,fr,en;q=0.9'
		});
		await insertVisit(ctx.db, {
			...visit,
			path: '/',
			outcome: 'invalid',
			visited_at: now - 2000,
			accept_language: 'DE'
		});
		await insertVisit(ctx.db, {
			...visit,
			path: '/missing',
			outcome: 'invalid',
			visited_at: now - 1000,
			accept_language: 'en;q=0.8'
		});
		await maintainVisits(ctx, now);
		expect(await readVisitTotals(ctx.db, overview)).toEqual({
			validVisits: 1003,
			invalidVisits: 1
		});
		expect(await readVisitTotals(ctx.db, domain)).toEqual({ validVisits: 1003, invalidVisits: 1 });
		expect(await readVisitTotals(ctx.db, docs)).toEqual({ validVisits: 1002, invalidVisits: 0 });
		expect(await readVisitTotals(ctx.db, root)).toEqual({ validVisits: 1, invalidVisits: 0 });
		expect(await readVisitTotals(ctx.db, { ...docs, path: '/missing' })).toEqual({
			validVisits: 0,
			invalidVisits: 0
		});
		expect(await readTotals(ctx.db, domain)).toEqual({ validVisits: 2, invalidVisits: 1 });
		expect(await readTotals(ctx.db, docs)).toEqual({ validVisits: 1, invalidVisits: 0 });
		expect(await readTotals(ctx.db, root)).toEqual({ validVisits: 1, invalidVisits: 0 });
		const details = await readVisitDetails(ctx.db, domain, period);
		expect(details.lastActivityAt).toBe(new Date(now - 1000).toISOString());
		expect(details.daily[0]).toMatchObject({ partial: true, validVisits: 1, invalidVisits: 0 });
		expect(
			await ctx.db
				.selectFrom('visits')
				.select(['path', 'outcome', 'processed'])
				.where('path', '=', '/')
				.execute()
		).toEqual([{ path: '/', outcome: 'invalid', processed: 1 }]);
		expect(await ctx.db.selectFrom('visits').select('id').execute()).toHaveLength(3);
		const dailyRows = await ctx.db.selectFrom('visit_daily_statistics').selectAll().execute();
		const statements = vi.spyOn(DatabaseSync.prototype, 'prepare');
		try {
			await maintainVisits(ctx, now);
			for (const [query] of statements.mock.calls)
				expect(query).not.toMatch(/^\s*(insert|update).*(visit_daily_statistics|visit_totals)/i);
		} finally {
			statements.mockRestore();
		}
		expect(await ctx.db.selectFrom('visit_daily_statistics').selectAll().execute()).toEqual(
			dailyRows
		);
		expect(await readTotals(ctx.db, overview)).toEqual(await readTotals(ctx.db, domain));
	} finally {
		await ctx.db.destroy();
	}
});

test('zero counts minimal pending visits before cleanup, retries marked leftovers and preserves pending rows', async () => {
	const ctx = await context();
	try {
		await insertVisit(ctx.db, { ...visit, visited_at: reportNow - 1 });
		await maintainVisits(ctx, reportNow);
		await insertVisit(ctx.db, {
			...visit,
			ip: null,
			browser: 'Other',
			os: 'Other',
			visited_at: reportNow - 1
		});
		await insertVisit(ctx.db, { ...visit, ip: null, visited_at: reportNow + 1 });
		ctx.config.analytics.retention_months = 0;
		vi.mocked(addDailyStatistics).mockClear();
		const failure = new Error('Processed cleanup interrupted');
		vi.mocked(deleteProcessedVisitBatch).mockRejectedValueOnce(failure);
		await expect(maintainVisits(ctx, reportNow)).rejects.toBe(failure);
		expect(await readVisitTotals(ctx.db, docs)).toEqual({ validVisits: 2, invalidVisits: 0 });
		expect(await ctx.db.selectFrom('visits').select('processed').orderBy('id').execute()).toEqual([
			{ processed: 1 },
			{ processed: 1 },
			{ processed: 0 }
		]);
		expect(await ctx.db.selectFrom('visit_daily_statistics').selectAll().execute()).toEqual([]);
		await maintainVisits(ctx, reportNow);
		expect(await ctx.db.selectFrom('visits').select('processed').execute()).toEqual([
			{ processed: 0 }
		]);
		expect(await readVisitTotals(ctx.db, docs)).toEqual({ validVisits: 2, invalidVisits: 0 });
		await maintainVisits(ctx, reportNow + 2);
		expect(await ctx.db.selectFrom('visits').selectAll().execute()).toEqual([]);
		expect(await readVisitTotals(ctx.db, docs)).toEqual({ validVisits: 3, invalidVisits: 0 });
		expect(addDailyStatistics).not.toHaveBeenCalled();
	} finally {
		await ctx.db.destroy();
	}
});

test('partial daily cache loss warns with bounded examples, continues raw expiry and sweeps real orphans', async () => {
	const ctx = await context();
	const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
	try {
		const cutoff = Date.parse(period.from);
		for (const daysBefore of [1, 2]) {
			await insertVisit(ctx.db, { ...visit, visited_at: cutoff - daysBefore * 86_400_000 });
		}
		await insertVisit(ctx.db, { ...visit, visited_at: reportNow - 86_400_000 });
		const failure = new Error('Raw deletion unavailable');
		vi.mocked(deleteExpiredVisitBatch).mockRejectedValueOnce(failure);
		await expect(maintainVisits(ctx, reportNow)).rejects.toBe(failure);
		expect(await ctx.db.selectFrom('visits').select('processed').execute()).toEqual(
			Array.from({ length: 3 }, () => ({ processed: 1 }))
		);
		await ctx.db.deleteFrom('visit_daily_statistics').execute();
		await warnIfDailyStatisticsMissing(ctx.db);
		expect(warning).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining(
				'visit_daily_statistics is empty while visits contains processed rows'
			)
		);
		const orphan = getVisitFacts({
			...visit,
			id: 0,
			processed: 1,
			visited_at: cutoff - 7 * 86_400_000,
			ip: null,
			user_agent: null,
			accept_language: null
		});
		await ctx.db.transaction().execute((transaction) => addDailyStatistics(transaction, [orphan]));
		expect(await ctx.db.selectFrom('visit_daily_statistics').select('id').execute()).toHaveLength(
			3
		);
		expect(
			await ctx.db
				.selectFrom('visits')
				.select('id')
				.where('visited_at', '=', orphan.visitedAt)
				.execute()
		).toEqual([]);
		await maintainVisits(ctx, reportNow);
		expect(await ctx.db.selectFrom('visit_daily_statistics').select('id').execute()).toEqual([]);
		expect(await ctx.db.selectFrom('visits').select('visited_at').execute()).toEqual([
			{ visited_at: reportNow - 86_400_000 }
		]);
		const [summary, message] = warning.mock.lastCall ?? [];
		expect(message).toContain('Expired processed visits were deleted');
		expect(summary).toMatchObject({ table: 'visit_daily_statistics', skippedBucketUpdates: 6 });
		expect(summary).toHaveProperty('examples.length', 5);
		await maintainVisits(ctx, Date.parse('2026-09-01T00:00:00Z'));
		expect(await ctx.db.selectFrom('visits').select('id').execute()).toEqual([]);
		expect(await ctx.db.selectFrom('visit_daily_statistics').selectAll().execute()).toEqual([]);
		const warningsAfterCleanup = warning.mock.calls.length;
		await maintainVisits(ctx, Date.parse('2026-09-01T00:00:00Z'));
		expect(warning).toHaveBeenCalledTimes(warningsAfterCleanup);
		expect(JSON.stringify(warning.mock.calls)).not.toContain(visit.ip);
	} finally {
		await ctx.db.destroy();
	}
});

test('an inconsistent bucket is left unchanged while valid buckets and raw expiry commit', async () => {
	const ctx = await context();
	const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
	try {
		const cutoff = Date.parse(period.from);
		await insertVisit(ctx.db, { ...visit, visited_at: cutoff - 1 });
		await insertVisit(ctx.db, { ...visit, visited_at: cutoff });
		vi.mocked(deleteExpiredVisitBatch).mockRejectedValueOnce(new Error('Pause before expiry'));
		await expect(maintainVisits(ctx, reportNow)).rejects.toThrow('Pause before expiry');
		await ctx.db
			.updateTable('visit_daily_statistics')
			.set({ browsers_json: JSON.stringify([{ name: 'Other', validVisits: 2, invalidVisits: 0 }]) })
			.where('scope_kind', '=', 'overview')
			.execute();
		const bucket = await ctx.db
			.selectFrom('visit_daily_statistics')
			.selectAll()
			.where('scope_kind', '=', 'overview')
			.executeTakeFirstOrThrow();
		await maintainVisits(ctx, reportNow);
		expect(
			await ctx.db
				.selectFrom('visit_daily_statistics')
				.selectAll()
				.where('id', '=', bucket.id)
				.executeTakeFirstOrThrow()
		).toEqual(bucket);
		expect(await readTotals(ctx.db, domain)).toEqual({ validVisits: 1, invalidVisits: 0 });
		expect(await readTotals(ctx.db, docs)).toEqual({ validVisits: 1, invalidVisits: 0 });
		expect(await ctx.db.selectFrom('visits').select('visited_at').execute()).toEqual([
			{ visited_at: cutoff }
		]);
		expect(warning).toHaveBeenCalledExactlyOnceWith(
			{
				table: 'visit_daily_statistics',
				skippedBucketUpdates: 1,
				examples: [
					{
						scope: overview,
						day: '2026-03-02',
						rowId: bucket.id,
						reason: 'contribution-mismatch',
						stored: { validVisits: 2, invalidVisits: 0 },
						removing: { validVisits: 1, invalidVisits: 0 }
					}
				]
			},
			expect.stringContaining('Subtraction was skipped for the affected buckets')
		);
		await maintainVisits(ctx, Date.parse('2026-09-01T00:00:00Z'));
		expect(await ctx.db.selectFrom('visits').select('id').execute()).toEqual([]);
		expect(await ctx.db.selectFrom('visit_daily_statistics').select('id').execute()).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});

test('a failed pending batch rolls back counters and daily writes with its processed markers and retries', async () => {
	const ctx = await context();
	try {
		await insertVisit(ctx.db, { ...visit, visited_at: reportNow - 1 });
		const previousRows = await ctx.db.selectFrom('visit_daily_statistics').selectAll().execute();
		const actual = await vi.importActual<typeof import('./update-daily-statistics.js')>(
			'./update-daily-statistics.js'
		);
		const failure = new Error('Daily statistics write failed');
		vi.mocked(addDailyStatistics).mockImplementationOnce(async (...args) => {
			await actual.addDailyStatistics(...args);
			expect(await args[0].selectFrom('visit_daily_statistics').selectAll().execute()).not.toEqual(
				previousRows
			);
			throw failure;
		});
		await expect(maintainVisits(ctx, reportNow)).rejects.toBe(failure);
		expect(await ctx.db.selectFrom('visit_daily_statistics').selectAll().execute()).toEqual(
			previousRows
		);
		expect(await ctx.db.selectFrom('visits').select('processed').execute()).toEqual([
			{ processed: 0 }
		]);
		expect(await readVisitTotals(ctx.db, docs)).toEqual({ validVisits: 0, invalidVisits: 0 });
		await maintainVisits(ctx, reportNow);
		expect(await readVisitTotals(ctx.db, docs)).toEqual({ validVisits: 1, invalidVisits: 0 });
		expect((await readTotals(ctx.db, docs)).validVisits).toBe(1);
		expect(await ctx.db.selectFrom('visits').select('processed').execute()).toEqual([
			{ processed: 1 }
		]);
	} finally {
		await ctx.db.destroy();
	}
});

test('stops after the current batch when the captured positive policy changes without writing a clock', async () => {
	const ctx = await context();
	try {
		vi.mocked(processVisitBatch).mockImplementationOnce(async () => {
			ctx.config.analytics.retention_months = 9;
			return true;
		});
		await maintainVisits(ctx, reportNow);
		expect(processVisitBatch).toHaveBeenCalledOnce();
		expect(deleteExpiredVisitBatch).not.toHaveBeenCalled();
		expect((await readVisitDetails(ctx.db, overview, period)).lastActivityAt).toBeNull();
		expect(await ctx.db.selectFrom('visit_daily_statistics').selectAll().execute()).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});

test('a backdated visit after boundary capture counts next run without moving activity backward', async () => {
	const ctx = await context();
	try {
		await insertVisit(ctx.db, { ...visit, visited_at: reportNow - 2 });
		const actual = await vi.importActual<typeof import('@goto/db')>('@goto/db');
		vi.mocked(processVisitBatch).mockImplementationOnce(async (...args) => {
			await insertVisit(ctx.db, { ...visit, visited_at: reportNow - 3 });
			return actual.processVisitBatch(...args);
		});
		await maintainVisits(ctx, reportNow);
		expect(await ctx.db.selectFrom('visits').select('processed').orderBy('id').execute()).toEqual([
			{ processed: 1 },
			{ processed: 0 }
		]);
		expect((await readTotals(ctx.db, docs)).validVisits).toBe(1);
		await maintainVisits(ctx, reportNow);
		expect((await readTotals(ctx.db, docs)).validVisits).toBe(2);
		expect((await readVisitDetails(ctx.db, docs, period)).lastActivityAt).toBe(
			new Date(reportNow - 2).toISOString()
		);
	} finally {
		await ctx.db.destroy();
	}
});
