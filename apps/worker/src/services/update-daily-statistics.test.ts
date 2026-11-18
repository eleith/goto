import { createVisitPeriod, zeroVisitTotals, type ReportScope } from '@goto/analytics';
import { openDb, runMigrations, type ClassifiedVisit, type Visit } from '@goto/db';
import { readVisitDetails } from '@goto/db/visit-reports';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getVisitFacts } from './visit-facts.js';
import { addDailyStatistics, subtractDailyStatistics } from './update-daily-statistics.js';

let db: Awaited<ReturnType<typeof openDb>>;
const domain = 'go.example.test';
const overview = { kind: 'overview' } as const;
const domainScope = { kind: 'domain', domain } as const;
const docs = { kind: 'link', domain, path: '/docs' } as const;
const root = { kind: 'link', domain, path: '/' } as const;
const asOf = Date.UTC(2026, 3, 1, 12);
const period = createVisitPeriod(3, asOf);
const visit: ClassifiedVisit = {
	domain,
	path: '/docs',
	outcome: 'valid',
	visited_at: asOf - 1,
	ip: '127.0.0.1',
	user_agent: null,
	accept_language: 'en-US,en,fr;q=0.9',
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

async function readTotals(scope: ReportScope) {
	const details = await readVisitDetails(db, scope, period);
	return details.daily.reduce(
		(total, row) => ({
			validVisits: total.validVisits + row.validVisits,
			invalidVisits: total.invalidVisits + row.invalidVisits
		}),
		zeroVisitTotals()
	);
}

async function processRows(rows: ClassifiedVisit[]): Promise<Visit[]> {
	return db.transaction().execute(async (transaction) => {
		const visits = await transaction
			.insertInto('visits')
			.values(rows.map((row) => ({ ...row, processed: 0 })))
			.returningAll()
			.execute();
		await addDailyStatistics(transaction, visits.map(getVisitFacts));
		await transaction
			.updateTable('visits')
			.set({ processed: 1 })
			.where(
				'id',
				'in',
				visits.map(({ id }) => id)
			)
			.execute();
		return visits;
	});
}

test('actual events create scope/day rows with Root normalization, independent families and overlapping deduplicated languages', async () => {
	await processRows([
		visit,
		{ ...visit, outcome: 'invalid' },
		{
			...visit,
			path: '/',
			outcome: 'invalid',
			browser: 'Other',
			os: 'Other',
			accept_language: null
		},
		{
			...visit,
			path: '/unconfigured',
			outcome: 'invalid',
			browser: 'Other',
			os: 'Other',
			accept_language: null
		}
	]);
	expect(await readTotals(overview)).toEqual({ validVisits: 2, invalidVisits: 2 });
	expect(await readTotals(domainScope)).toEqual({ validVisits: 2, invalidVisits: 2 });
	expect(await readTotals(docs)).toEqual({ validVisits: 1, invalidVisits: 0 });
	expect(await readTotals(root)).toEqual({ validVisits: 1, invalidVisits: 0 });
	expect(await readVisitDetails(db, domainScope, period)).toMatchObject({
		version: 5,
		lastActivityAt: new Date(visit.visited_at).toISOString(),
		browsers: [
			{ day: '2026-04-01', name: 'Firefox', validVisits: 1, invalidVisits: 1 },
			{ day: '2026-04-01', name: 'Other', validVisits: 1, invalidVisits: 1 }
		],
		operatingSystems: [
			{ day: '2026-04-01', name: 'Linux', validVisits: 1, invalidVisits: 1 },
			{ day: '2026-04-01', name: 'Other', validVisits: 1, invalidVisits: 1 }
		],
		acceptedLanguages: [
			{ day: '2026-04-01', name: 'en', validVisits: 1, invalidVisits: 1 },
			{ day: '2026-04-01', name: 'fr', validVisits: 1, invalidVisits: 1 },
			{ day: '2026-04-01', name: 'Other', validVisits: 1, invalidVisits: 1 }
		]
	});
	const rows = await db.selectFrom('visit_daily_statistics').selectAll().execute();
	expect(rows).toHaveLength(4);
	expect(rows.find(({ scope_kind }) => scope_kind === 'overview')).toMatchObject({
		day: '2026-04-01',
		last_visit_at: visit.visited_at,
		valid_visits: 2,
		invalid_visits: 2
	});
	expect(JSON.parse(rows[0]!.browsers_json)[0]).not.toHaveProperty('day');
	expect(await readTotals({ kind: 'link', domain, path: '/unconfigured' })).toEqual(
		zeroVisitTotals()
	);
});

test('oldest-first subtraction preserves same-day survivors and activity, then deletes zero buckets', async () => {
	const before = Date.parse(period.from);
	const visits = await processRows([
		{ ...visit, path: '/', outcome: 'invalid', visited_at: before - 1 },
		{ ...visit, path: '/', outcome: 'invalid', visited_at: before }
	]);
	const rows = await db.selectFrom('visit_daily_statistics').selectAll().execute();
	expect(rows).toHaveLength(3);
	expect(rows.find(({ scope_kind }) => scope_kind === 'link')).toMatchObject({
		day: '2026-01-01',
		valid_visits: 2,
		invalid_visits: 0,
		last_visit_at: before
	});
	await db.transaction().execute(async (transaction) => {
		await transaction
			.updateTable('visits')
			.set({ processed: 1 })
			.where('id', '=', visits[0]!.id)
			.execute();
		await subtractDailyStatistics(transaction, [getVisitFacts(visits[0]!)]);
		await transaction.deleteFrom('visits').where('id', '=', visits[0]!.id).execute();
	});
	expect(await readTotals(root)).toEqual({ validVisits: 1, invalidVisits: 0 });
	expect(await readVisitDetails(db, root, period)).toMatchObject({
		lastActivityAt: new Date(before).toISOString(),
		browsers: [{ day: '2026-01-01', name: 'Firefox', validVisits: 1, invalidVisits: 0 }]
	});
	await db.transaction().execute(async (transaction) => {
		await transaction
			.updateTable('visits')
			.set({ processed: 1 })
			.where('id', '=', visits[1]!.id)
			.execute();
		await subtractDailyStatistics(transaction, [getVisitFacts(visits[1]!)]);
		await transaction.deleteFrom('visits').where('id', '=', visits[1]!.id).execute();
	});
	expect(await db.selectFrom('visit_daily_statistics').selectAll().execute()).toEqual([]);
	expect(await readTotals(root)).toEqual(zeroVisitTotals());
	expect(await readVisitDetails(db, root, period)).toMatchObject({
		lastActivityAt: null,
		browsers: []
	});
});

test('batches read no raw history, update only affected days and leave quiet data byte-identical without clock writes', async () => {
	await processRows([{ ...visit, domain: 'quiet.example.test', visited_at: asOf - 86_400_000 }]);
	const quietBefore = await db.selectFrom('visit_daily_statistics').selectAll().execute();
	const [pending] = await db
		.insertInto('visits')
		.values({ ...visit, processed: 0 })
		.returningAll()
		.execute();
	if (!pending) throw new Error('Expected visit fixture');
	const statements = vi.spyOn(DatabaseSync.prototype, 'prepare');
	try {
		await db.transaction().execute(async (transaction) => {
			await transaction
				.updateTable('visits')
				.set({ processed: 0 })
				.where('id', '=', pending.id)
				.execute();
			statements.mockClear();
			await addDailyStatistics(transaction, [getVisitFacts(pending)]);
			for (const [query] of statements.mock.calls) {
				expect(query).not.toMatch(/\bvisits\b|\bsum\s*\(|period_json|analytics_reports/i);
				if (/^select/i.test(query)) expect(query).toMatch(/\bwhere\b.*\bday\b/i);
			}
		});
	} finally {
		statements.mockRestore();
	}
	const after = await db.selectFrom('visit_daily_statistics').selectAll().execute();
	for (const row of quietBefore) expect(after.find(({ id }) => id === row.id)).toEqual(row);
	const quietStatements = vi.spyOn(DatabaseSync.prototype, 'prepare');
	try {
		await addDailyStatistics(db, []);
		await subtractDailyStatistics(db, []);
		expect(quietStatements).not.toHaveBeenCalled();
	} finally {
		quietStatements.mockRestore();
	}
	const later = createVisitPeriod(3, asOf + 86_400_000);
	expect((await readVisitDetails(db, overview, later)).period).toEqual(later);
	expect((await readVisitDetails(db, overview, later)).lastActivityAt).toBe(
		new Date(visit.visited_at).toISOString()
	);
});

test('events create valid-path rows without a YAML catalog', async () => {
	const [processed] = await processRows([{ ...visit, path: '/not-in-yaml' }]);
	if (!processed) throw new Error('Expected visit fixture');
	expect(await readTotals({ ...docs, path: '/not-in-yaml' })).toEqual({
		validVisits: 1,
		invalidVisits: 0
	});
});
