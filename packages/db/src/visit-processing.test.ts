import { checkDailyStatistics, type DailyVisitStatistics } from '@goto/analytics';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
	captureVisitBoundary,
	deleteExpiredVisitBatch,
	insertVisit,
	openDb,
	processVisitBatch,
	runMigrations,
	type ClassifiedVisit,
	type Database,
	type Visit
} from './index.js';
import { addDailyVisitStatistics, subtractDailyVisitStatistics } from './visit-reports/index.js';

let db: Kysely<Database>;
const visit: ClassifiedVisit = {
	domain: 'go.example.test',
	path: '/docs',
	outcome: 'valid',
	visited_at: 10,
	ip: '127.0.0.1',
	user_agent: null,
	accept_language: null,
	browser: 'Firefox',
	os: 'Linux'
};

beforeEach(async () => {
	db = await openDb(':memory:');
	await runMigrations(db);
});

afterEach(async () => {
	await db.destroy();
});

test('processes pending rows once in bounded ID batches under a fixed saved boundary and timestamp', async () => {
	expect(await captureVisitBoundary(db)).toBe(0);
	await db
		.insertInto('visits')
		.values([...Array.from({ length: 1001 }, () => visit), { ...visit, visited_at: 20 }])
		.execute();
	const throughId = await captureVisitBoundary(db);
	expect(throughId).toBe(1002);
	const lateId = await insertVisit(db, { ...visit, visited_at: 1 });
	const batches: number[][] = [];
	const applyStatistics = async (transaction: Kysely<Database>, visits: Visit[]) => {
		batches.push(visits.map(({ id }) => id));
		await addDailyVisitStatistics(transaction, [overviewDelta(visits)]);
	};
	const processBatch = () => processVisitBatch(db, { throughId, asOf: 20 }, applyStatistics);
	expect(await processBatch()).toBe(true);
	expect(await processBatch()).toBe(false);
	expect(await processBatch()).toBe(false);
	expect(batches.map((batch) => batch.length)).toEqual([1000, 1]);
	expect(batches[0]?.[0]).toBe(1);
	expect(batches[0]?.[999]).toBe(1000);
	expect(batches[1]).toEqual([1001]);
	expect(
		await db.selectFrom('visits').select('id').where('processed', '=', 1).execute()
	).toHaveLength(1001);
	expect(
		await db.selectFrom('visits').select('id').where('processed', '=', 0).orderBy('id').execute()
	).toEqual([{ id: throughId }, { id: lateId }]);
	expect(await db.selectFrom('visit_daily_statistics').selectAll().execute()).toMatchObject([
		{ scope_kind: 'overview', valid_visits: 1001, invalid_visits: 0, last_visit_at: 10 }
	]);
});

test('subtracts and deletes only expired processed rows in bounded saved-ID batches', async () => {
	await db
		.insertInto('visits')
		.values([
			...Array.from({ length: 1001 }, () => ({ ...visit, processed: 1 as const })),
			{ ...visit, processed: 1, visited_at: 20 },
			{ ...visit, processed: 0, visited_at: 1 }
		])
		.execute();
	const throughId = await captureVisitBoundary(db);
	await db
		.insertInto('visits')
		.values({ ...visit, processed: 1, visited_at: 1 })
		.execute();
	const processed = await db.selectFrom('visits').selectAll().where('processed', '=', 1).execute();
	await db
		.transaction()
		.execute((transaction) => addDailyVisitStatistics(transaction, [overviewDelta(processed)]));
	const batches: number[][] = [];
	const deleteBatch = () =>
		deleteExpiredVisitBatch(db, { throughId, before: 20 }, async (transaction, visits) => {
			batches.push(visits.map(({ id }) => id));
			expect(await subtractDailyVisitStatistics(transaction, [overviewDelta(visits)])).toEqual([]);
		});
	expect(await deleteBatch()).toBe(true);
	expect(await deleteBatch()).toBe(false);
	expect(await deleteBatch()).toBe(false);
	expect(batches.map((batch) => batch.length)).toEqual([1000, 1]);
	expect(batches[1]).toEqual([1001]);
	expect(await db.selectFrom('visits').select(['id', 'processed']).orderBy('id').execute()).toEqual(
		[
			{ id: 1002, processed: 1 },
			{ id: 1003, processed: 0 },
			{ id: 1004, processed: 1 }
		]
	);
	expect(await db.selectFrom('visit_daily_statistics').selectAll().execute()).toMatchObject([
		{ scope_kind: 'overview', valid_visits: 2, invalid_visits: 0, last_visit_at: 20 }
	]);
});

test('failed retained-statistics removal rolls back its writes and preserves processed raw rows', async () => {
	await db
		.insertInto('visits')
		.values({ ...visit, processed: 1 })
		.execute();
	const processed = await db.selectFrom('visits').selectAll().execute();
	await db
		.transaction()
		.execute((transaction) => addDailyVisitStatistics(transaction, [overviewDelta(processed)]));
	const before = await db.selectFrom('visit_daily_statistics').selectAll().execute();
	const failure = new Error('Retained statistics removal failed');
	await expect(
		deleteExpiredVisitBatch(db, { throughId: 1, before: 20 }, async (transaction, visits) => {
			expect(await subtractDailyVisitStatistics(transaction, [overviewDelta(visits)])).toEqual([]);
			expect(await transaction.selectFrom('visit_daily_statistics').selectAll().execute()).toEqual(
				[]
			);
			throw failure;
		})
	).rejects.toThrow(failure);
	expect(await db.selectFrom('visits').select(['id', 'processed']).execute()).toEqual([
		{ id: 1, processed: 1 }
	]);
	expect(await db.selectFrom('visit_daily_statistics').selectAll().execute()).toEqual(before);
});

function overviewDelta(visits: Visit[]): DailyVisitStatistics {
	const validVisits = visits.filter(({ outcome }) => outcome === 'valid').length;
	const counts = { validVisits, invalidVisits: visits.length - validVisits };
	return checkDailyStatistics({
		scope: { kind: 'overview' },
		day: '1970-01-01',
		lastVisitAt: Math.max(...visits.map(({ visited_at }) => visited_at)),
		...counts,
		browsers: [{ name: visit.browser, ...counts }],
		operatingSystems: [{ name: visit.os, ...counts }],
		acceptedLanguages: [{ name: 'Other', ...counts }]
	});
}
