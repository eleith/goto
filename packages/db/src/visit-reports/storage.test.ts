import {
	createVisitPeriod,
	emptyDailyStatistics,
	projectVisitDetails,
	type DailyVisitStatistics,
	type ReportScope
} from '@goto/analytics';
import { DatabaseSync } from 'node:sqlite';
import { sql, type Kysely } from 'kysely';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { addVisitTotals, openDb, runMigrations } from '../index.js';
import type { Database } from '../types.js';
import {
	addDailyVisitStatistics,
	subtractDailyVisitStatistics,
	clearDailyVisitStatistics,
	deleteExpiredDailyStatistics,
	readVisitDetails,
	readAnalyticsVisitDetails,
	readLinkVisitDetails,
	readLastVisitActivity
} from './storage.js';

let db: Awaited<ReturnType<typeof openDb>>;
const domain = 'go.example.test';
const overviewScope = { kind: 'overview' } as const;
const domainScope = { kind: 'domain', domain } as const;
const rootScope = { kind: 'link', domain, path: '/' } as const;
const period = createVisitPeriod(3, Date.UTC(2026, 5, 30, 6));

beforeEach(async () => {
	db = await openDb(':memory:');
	await runMigrations(db);
});

afterEach(async () => {
	await db.destroy();
});

function daily(
	scope: ReportScope,
	validVisits = 1,
	invalidVisits = 0,
	hour = 10
): DailyVisitStatistics {
	const counts = { validVisits, invalidVisits };
	return {
		...emptyDailyStatistics(scope, '2026-04-01'),
		...counts,
		lastVisitAt: Date.UTC(2026, 3, 1, hour),
		browsers: [{ name: 'Firefox', ...counts }],
		operatingSystems: [{ name: 'Linux', ...counts }],
		acceptedLanguages: [
			{ name: 'en', ...counts },
			{ name: 'fr', ...counts }
		]
	};
}

async function writer<T>(work: (transaction: Kysely<Database>) => Promise<T>): Promise<T> {
	return db.transaction().execute(async (transaction) => {
		await transaction
			.updateTable('visits')
			.set({ processed: sql`processed` })
			.where('id', '=', -1)
			.execute();
		return work(transaction);
	});
}

async function add(...deltas: DailyVisitStatistics[]): Promise<void> {
	await writer((transaction) => addDailyVisitStatistics(transaction, deltas));
}

test('native daily UPSERT adds SQL counters and day-only JSON; oldest-first partial expiry keeps event activity', async () => {
	const early = daily(rootScope, 2, 0, 1);
	const later = daily(rootScope, 1, 0, 10);
	const nextDay = {
		...daily(rootScope, 4),
		day: '2026-04-02',
		lastVisitAt: Date.UTC(2026, 3, 2, 10)
	};
	await writer((transaction) => addDailyVisitStatistics(transaction, [early, nextDay]));
	const untouched = await db
		.selectFrom('visit_daily_statistics')
		.selectAll()
		.where('day', '=', nextDay.day)
		.executeTakeFirstOrThrow();
	const statements = vi.spyOn(DatabaseSync.prototype, 'prepare');
	try {
		await add(later);
		expect(
			await writer((transaction) => subtractDailyVisitStatistics(transaction, [early]))
		).toEqual([]);
		const upsert = statements.mock.calls.find(([query]) =>
			/INSERT INTO visit_daily_statistics/i.test(query)
		)?.[0];
		expect(upsert).toMatch(/ON CONFLICT DO UPDATE/);
		expect(upsert).toMatch(/valid_visits = visit_daily_statistics.valid_visits \+/);
		expect(upsert).not.toContain('Firefox');
		const subtraction = statements.mock.calls.find(([query]) =>
			/^update "visit_daily_statistics"/i.test(query)
		)?.[0];
		expect(subtraction).toMatch(/valid_visits -/);
		expect(subtraction).toMatch(/where "id" =/);
	} finally {
		statements.mockRestore();
	}
	const remaining = await db
		.selectFrom('visit_daily_statistics')
		.selectAll()
		.where('day', '=', early.day)
		.executeTakeFirstOrThrow();
	expect(remaining).toMatchObject({
		valid_visits: 1,
		invalid_visits: 0,
		last_visit_at: later.lastVisitAt
	});
	expect(JSON.parse(remaining.browsers_json)).toEqual(later.browsers);
	expect(JSON.parse(remaining.accepted_languages_json)).toEqual(later.acceptedLanguages);
	expect(
		await db
			.selectFrom('visit_daily_statistics')
			.selectAll()
			.where('day', '=', nextDay.day)
			.executeTakeFirstOrThrow()
	).toEqual(untouched);
	const details = await readVisitDetails(db, rootScope, period);
	expect(details.version).toBe(5);
	expect(details.daily[0]).toMatchObject({ partial: true, validVisits: 1, invalidVisits: 0 });
	expect(details.lastActivityAt).toBe('2026-04-02T10:00:00.000Z');
	await writer((transaction) => subtractDailyVisitStatistics(transaction, [later]));
	expect(
		await db
			.selectFrom('visit_daily_statistics')
			.select('id')
			.where('day', '=', early.day)
			.execute()
	).toEqual([]);
});

test('missing or inconsistent removals report exact mismatches without changing those rows or stopping siblings', async () => {
	const siblingScope = { kind: 'link', domain, path: '/ok' } as const;
	await add(daily(domainScope), daily(rootScope, 2), daily(siblingScope, 3, 1));
	const before = await db.selectFrom('visit_daily_statistics').selectAll().orderBy('id').execute();
	const domainRow = before.find((row) => row.scope_kind === 'domain')!;
	const rootRow = before.find((row) => row.path === '/')!;
	const siblingRow = before.find((row) => row.path === '/ok')!;
	const missing = daily(overviewScope);
	const underflow = daily(domainScope, 2);
	const overlappingLanguages = {
		...daily(rootScope),
		acceptedLanguages: [{ name: 'en', validVisits: 1, invalidVisits: 0 }]
	};
	const mismatches = await writer((transaction) =>
		subtractDailyVisitStatistics(transaction, [
			missing,
			underflow,
			overlappingLanguages,
			daily(siblingScope, 1, 1)
		])
	);
	expect(mismatches).toEqual([
		{
			scope: overviewScope,
			day: missing.day,
			rowId: null,
			reason: 'missing',
			stored: null,
			removing: { validVisits: 1, invalidVisits: 0 }
		},
		{
			scope: domainScope,
			day: underflow.day,
			rowId: domainRow.id,
			reason: 'contribution-mismatch',
			stored: { validVisits: 1, invalidVisits: 0 },
			removing: { validVisits: 2, invalidVisits: 0 }
		},
		{
			scope: rootScope,
			day: overlappingLanguages.day,
			rowId: rootRow.id,
			reason: 'contribution-mismatch',
			stored: { validVisits: 2, invalidVisits: 0 },
			removing: { validVisits: 1, invalidVisits: 0 }
		}
	]);
	const after = await db.selectFrom('visit_daily_statistics').selectAll().orderBy('id').execute();
	expect(after.filter((row) => row.id !== siblingRow.id)).toEqual(
		before.filter((row) => row.id !== siblingRow.id)
	);
	const remaining = daily(siblingScope, 2);
	expect(after.find((row) => row.id === siblingRow.id)).toEqual({
		...siblingRow,
		valid_visits: remaining.validVisits,
		invalid_visits: remaining.invalidVisits,
		browsers_json: JSON.stringify(remaining.browsers),
		operating_systems_json: JSON.stringify(remaining.operatingSystems),
		accepted_languages_json: JSON.stringify(remaining.acceptedLanguages)
	});
});

test('expiry deletes fully expired orphan days by event time and keeps activity at the cutoff in the same day', async () => {
	const expired = daily(overviewScope, 3, 1, 1);
	const boundary = daily(domainScope, 2, 0, 10);
	await add(expired, boundary);
	expect(await db.selectFrom('visits').selectAll().execute()).toEqual([]);
	const kept = await db
		.selectFrom('visit_daily_statistics')
		.selectAll()
		.where('scope_kind', '=', 'domain')
		.executeTakeFirstOrThrow();
	await deleteExpiredDailyStatistics(db, boundary.lastVisitAt);
	expect(await db.selectFrom('visit_daily_statistics').selectAll().execute()).toEqual([kept]);
});

test('daily writes and raw processing share caller rollback, with no independent commit', async () => {
	await db
		.insertInto('visits')
		.values({
			domain,
			path: '/',
			outcome: 'invalid',
			visited_at: Date.UTC(2026, 3, 1, 1),
			ip: '127.0.0.1',
			user_agent: null,
			accept_language: null,
			browser: 'Firefox',
			os: 'Linux'
		})
		.execute();
	await expect(
		writer(async (transaction) => {
			await addDailyVisitStatistics(transaction, [daily(overviewScope), daily(rootScope)]);
			await transaction.updateTable('visits').set({ processed: 1 }).execute();
			throw new Error('abort visit batch');
		})
	).rejects.toThrow('abort visit batch');
	expect(await db.selectFrom('visit_daily_statistics').selectAll().execute()).toEqual([]);
	expect(await db.selectFrom('visits').select('processed').execute()).toEqual([{ processed: 0 }]);
});

test('selected-link readers bind exact path/domain pairs and ignore distractors', async () => {
	const path = "/' OR 1=1 --";
	const link = { kind: 'link', domain, path } as const;
	const other = { kind: 'link', domain: 'other.example.test', path: '/faq' } as const;
	await add(
		daily(domainScope, 6, 2),
		daily(rootScope, 1),
		daily(link, 5, 0, 11),
		daily(other, 7, 0, 12),
		daily({ kind: 'link', domain, path: '/faq' }, 99, 0, 13),
		daily({ kind: 'link', domain: 'other.example.test', path }, 99, 0, 14)
	);
	await db
		.updateTable('visit_daily_statistics')
		.set({ accepted_languages_json: '["private"]' })
		.where('scope_kind', '=', 'link')
		.where('domain', '=', domain)
		.where('path', '=', '/faq')
		.execute();
	const selected = await readLinkVisitDetails(db, [link, other, link], period);
	expect(
		selected.links.map(({ domain, path, details }) => ({
			domain,
			path,
			visits: details.daily[0]!.validVisits
		}))
	).toEqual([
		{ domain, path, visits: 5 },
		{ domain: other.domain, path: other.path, visits: 7 }
	]);
	expect(await readLinkVisitDetails(db, [], period)).toEqual({ period, links: [] });
	expect(await readLastVisitActivity(db, period, [link, other])).toBe('2026-04-01T12:00:00.000Z');
	expect(await readLastVisitActivity(db, period, [])).toBeNull();
});

test('Analytics separates Root visits without changing invalid clicks or counting roots in link breakdowns', async () => {
	const otherDomain = { kind: 'domain', domain: 'old.example.test' } as const;
	const otherRoot = { ...rootScope, domain: otherDomain.domain };
	const docs = { ...rootScope, path: '/docs' };
	const root = daily(rootScope, 2, 0, 12);
	const day = '2026-04-01';
	const nextDay = '2026-04-02';
	const rootOnlyDay = '2026-04-03';
	const rootOnlyVisitAt = Date.parse(`${rootOnlyDay}T10:00:00Z`);
	const nextDayTotals = { validVisits: 3, invalidVisits: 1 };
	await writer(async (transaction) => {
		await addVisitTotals(transaction, [
			{ scope: domainScope, totals: { validVisits: 7, invalidVisits: 2 } },
			{ scope: otherDomain, totals: { validVisits: 3, invalidVisits: 1 } }
		]);
		await addDailyVisitStatistics(transaction, [
			daily(overviewScope, 6, 2, 12),
			daily(domainScope, 4, 1, 12),
			root,
			daily(otherRoot, 2),
			daily(docs, 2),
			{
				...daily(overviewScope, nextDayTotals.validVisits, nextDayTotals.invalidVisits),
				day: nextDay,
				lastVisitAt: Date.parse(`${nextDay}T10:00:00Z`)
			},
			{ ...daily(overviewScope), day: rootOnlyDay, lastVisitAt: rootOnlyVisitAt },
			{ ...daily(otherRoot), day: rootOnlyDay, lastVisitAt: rootOnlyVisitAt }
		]);
	});

	const overview = await readAnalyticsVisitDetails(db, overviewScope, period);
	expect(overview.daily.find(({ start }) => start.startsWith(day))).toMatchObject({
		validVisits: 2,
		invalidVisits: 2,
		rootVisits: 4
	});
	expect(overview.daily.find(({ start }) => start.startsWith(nextDay))).toMatchObject(
		nextDayTotals
	);
	expect(overview.daily.find(({ start }) => start.startsWith(rootOnlyDay))).toMatchObject({
		validVisits: 0,
		invalidVisits: 0,
		rootVisits: 1
	});
	expect(overview.lastActivityAt).toBe(new Date(rootOnlyVisitAt).toISOString());
	expect(overview.browsers).toEqual([
		{ day, name: 'Firefox', validVisits: 2, invalidVisits: 2 },
		{ day: nextDay, name: 'Firefox', ...nextDayTotals }
	]);
	expect(overview.operatingSystems).toContainEqual({
		day,
		name: 'Linux',
		validVisits: 2,
		invalidVisits: 2
	});
	expect(overview.acceptedLanguages.filter((row) => row.day === day)).toEqual([
		{ day, name: 'en', validVisits: 2, invalidVisits: 2 },
		{ day, name: 'fr', validVisits: 2, invalidVisits: 2 }
	]);
	const scoped = await readAnalyticsVisitDetails(db, domainScope, period);
	expect(scoped.daily[0]).toMatchObject({ validVisits: 2, invalidVisits: 1, rootVisits: 2 });
	expect(scoped.lastActivityAt).toBe('2026-04-01T12:00:00.000Z');
	expect((await readAnalyticsVisitDetails(db, rootScope, period)).daily[0]).toMatchObject({
		validVisits: 2,
		invalidVisits: 0
	});
	expect((await readAnalyticsVisitDetails(db, docs, period)).daily[0]).toMatchObject({
		validVisits: 2,
		invalidVisits: 0
	});
});

test('reports stored Root and aggregate counts without reconciling them', async () => {
	await add(daily(domainScope, 1, 1), daily(rootScope, 2));

	const report = await readAnalyticsVisitDetails(db, domainScope, period);
	expect(report.daily[0]).toMatchObject({ validVisits: -1, invalidVisits: 1, rootVisits: 2 });
	expect(report.lastActivityAt).toBe('2026-04-01T10:00:00.000Z');
});

test('successful empty reads give zeros/activity null; view time advances without writes and zero clears derived rows', async () => {
	expect(await readVisitDetails(db, overviewScope, period)).toEqual(
		projectVisitDetails(overviewScope, period, [])
	);
	expect(await readVisitDetails(db, domainScope, period)).toEqual(
		projectVisitDetails(domainScope, period, [])
	);
	expect(await readLastVisitActivity(db, period)).toBeNull();
	await add(daily(overviewScope), daily(domainScope, 1, 0, 11));
	const before = await db.selectFrom('visit_daily_statistics').selectAll().execute();
	const nextPeriod = createVisitPeriod(3, Date.UTC(2026, 7, 2));
	expect((await readVisitDetails(db, overviewScope, nextPeriod)).lastActivityAt).toBeNull();
	expect(await readLastVisitActivity(db, nextPeriod)).toBeNull();
	expect(await db.selectFrom('visit_daily_statistics').selectAll().execute()).toEqual(before);
	expect(await readLastVisitActivity(db, period)).toBe('2026-04-01T10:00:00.000Z');
	expect(await readLastVisitActivity(db, period, domainScope)).toBe('2026-04-01T11:00:00.000Z');
	await clearDailyVisitStatistics(db);
	expect((await readVisitDetails(db, overviewScope, period)).lastActivityAt).toBeNull();
});

test('selected corrupt day JSON fails with a static error, while a failed table read is not reported as zero', async () => {
	await add(daily(overviewScope));
	await db
		.updateTable('visit_daily_statistics')
		.set({ browsers_json: '[{"name":"private IP","validVisits":99,"invalidVisits":0}]' })
		.execute();
	await expect(readAnalyticsVisitDetails(db, overviewScope, period)).rejects.toThrow(
		/^Invalid analytics report$/
	);
	await expect(
		writer((transaction) => addDailyVisitStatistics(transaction, [daily(overviewScope)]))
	).rejects.toThrow(/^Invalid analytics report$/);
	await expect(
		writer((transaction) => subtractDailyVisitStatistics(transaction, [daily(overviewScope)]))
	).rejects.toThrow(/^Invalid analytics report$/);
	await db.schema.dropTable('visit_daily_statistics').execute();
	await expect(readVisitDetails(db, overviewScope, period)).rejects.toThrow();
	await expect(readLastVisitActivity(db, period)).rejects.toThrow();
});

test('daily SQL identities are unique by scope/day and preserve independent outcomes and dates', async () => {
	await add(daily(overviewScope, 2, 1), daily(domainScope, 2, 1), daily(rootScope));
	const rows = await db.selectFrom('visit_daily_statistics').selectAll().execute();
	for (const row of rows) {
		await expect(
			db
				.insertInto('visit_daily_statistics')
				.values({ ...row, id: undefined })
				.execute()
		).rejects.toThrow();
	}
	const first = rows[0]!;
	await db
		.insertInto('visit_daily_statistics')
		.values({
			...first,
			id: undefined,
			day: '2026-04-02',
			last_visit_at: Date.UTC(2026, 3, 2, 1)
		})
		.execute();
	expect(await db.selectFrom('visit_daily_statistics').select('id').execute()).toHaveLength(4);
});
