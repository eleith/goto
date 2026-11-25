import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { Migrator, sql, type Migration } from 'kysely';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	addVisitTotals,
	insertVisit,
	openDb,
	readLinkVisitCountsIncludingPending,
	runMigrations,
	type ClassifiedVisit
} from './index.js';
import { migrations } from './migrations/index.js';

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'goto-db-'));
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

const visit: ClassifiedVisit = {
	domain: 'go.example.test',
	path: '/café',
	outcome: 'valid',
	visited_at: 1_700_000_000_000,
	ip: '2001:db8::1',
	user_agent: 'Mozilla/5.0 (X11; Linux x86_64; rv:158.0) Gecko/20100101 Firefox/158.0',
	accept_language: 'en-US,en;q=0.9',
	browser: 'Firefox',
	os: 'Linux'
};

test('opens a real WAL database and initializes the current schema once', async () => {
	const db = await openDb(join(directory, 'data/visits.sqlite'));
	try {
		expect(
			(await sql<{ journal_mode: string }>`PRAGMA journal_mode`.execute(db)).rows[0]?.journal_mode
		).toBe('wal');
		expect(
			(await sql<{ synchronous: number }>`PRAGMA synchronous`.execute(db)).rows[0]?.synchronous
		).toBe(1);
		expect((await sql<{ timeout: number }>`PRAGMA busy_timeout`.execute(db)).rows[0]?.timeout).toBe(
			5000
		);
		expect(await runMigrations(db)).toEqual(['0001_initial']);
		const tables = await db.introspection.getTables();
		const names = tables.map((table) => table.name);
		expect(names).toEqual(
			expect.arrayContaining(['visits', 'visit_daily_statistics', 'visit_totals'])
		);
		expect(names).toHaveLength(3);
		expect(
			tables.find((table) => table.name === 'visits')?.columns.find(({ name }) => name === 'ip')
				?.isNullable
		).toBe(true);
		expect(
			tables
				.find((table) => table.name === 'visit_daily_statistics')
				?.columns.map(({ name }) => name)
		).toEqual([
			'id',
			'scope_kind',
			'domain',
			'path',
			'day',
			'valid_visits',
			'invalid_visits',
			'last_visit_at',
			'browsers_json',
			'operating_systems_json',
			'accepted_languages_json'
		]);
		expect(await runMigrations(db)).toEqual([]);
	} finally {
		await db.destroy();
	}
});

test('persists request-time outcomes for the same logical path on different domains', async () => {
	const path = join(directory, 'visits.sqlite');
	const writer = await openDb(path);
	const ids: number[] = [];
	try {
		await runMigrations(writer);
		ids.push(await insertVisit(writer, visit));
		ids.push(
			await insertVisit(writer, {
				...visit,
				domain: 'tiny.example.test',
				outcome: 'invalid',
				ip: null,
				user_agent: null,
				accept_language: null,
				browser: 'Other',
				os: 'Other'
			})
		);
	} finally {
		await writer.destroy();
	}
	const reader = await openDb(path, { readOnly: true });
	try {
		const rows = await reader.selectFrom('visits').selectAll().orderBy('id').execute();
		expect(rows).toEqual([
			{ ...visit, id: ids[0], processed: 0 },
			{
				...visit,
				domain: 'tiny.example.test',
				outcome: 'invalid',
				id: ids[1],
				processed: 0,
				ip: null,
				user_agent: null,
				accept_language: null,
				browser: 'Other',
				os: 'Other'
			}
		]);
		await expect(insertVisit(reader, visit)).rejects.toThrow();
	} finally {
		await reader.destroy();
	}
});

test('link recovery keeps the same visit counts across an uncommitted worker rollup and its commit', async () => {
	const path = join(directory, 'visit-counts.sqlite');
	const writer = await openDb(path);
	let reader: Awaited<ReturnType<typeof openDb>> | undefined;
	try {
		await runMigrations(writer);
		await insertVisit(writer, visit);
		await insertVisit(writer, { ...visit, outcome: 'invalid' });
		await insertVisit(writer, { ...visit, domain: 'other.example.test' });
		reader = await openDb(path, { readOnly: true });
		const links = [
			{ domain: visit.domain, path: visit.path },
			{ domain: visit.domain, path: '/absent' }
		];
		const expected = [
			{ ...links[0], visits: 1 },
			{ ...links[1], visits: 0 }
		];
		const recovery = () => readLinkVisitCountsIncludingPending(reader!, links);
		expect(await recovery()).toEqual(expected);
		await writer.transaction().execute(async (transaction) => {
			await addVisitTotals(transaction, [
				{
					scope: { kind: 'link', domain: visit.domain, path: visit.path },
					totals: { validVisits: 1, invalidVisits: 0 }
				}
			]);
			await transaction.updateTable('visits').set({ processed: 1 }).where('id', '=', 1).execute();
			expect(await recovery()).toEqual(expected);
		});
		expect(await recovery()).toEqual(expected);
		await insertVisit(writer, visit);
		expect(await recovery()).toEqual([{ ...links[0], visits: 2 }, expected[1]]);
	} finally {
		await reader?.destroy();
		await writer.destroy();
	}
});

test('failed initialization rolls back schema and bookkeeping so startup can retry', async () => {
	const db = await openDb(join(directory, 'failed-migration.sqlite'));
	try {
		const failure = new Error('Simulated failure after schema creation');
		const failedInitialization: Migration = {
			async up(transaction) {
				await migrations['0001_initial'].up(transaction);
				throw failure;
			}
		};
		const migrator = new Migrator({
			db,
			provider: {
				async getMigrations() {
					return { '0001_initial': failedInitialization };
				}
			}
		});

		expect((await migrator.migrateToLatest()).error).toBe(failure);
		expect(await runMigrations(db)).toEqual(['0001_initial']);
		expect(await runMigrations(db)).toEqual([]);
	} finally {
		await db.destroy();
	}
});

test('destroy closes an opened database without an intervening query', async () => {
	const close = vi.spyOn(DatabaseSync.prototype, 'close');
	try {
		const db = await openDb(join(directory, 'unused.sqlite'));
		await db.destroy();
		expect(close).toHaveBeenCalledOnce();
	} finally {
		close.mockRestore();
	}
});

test('a read-only open does not create a missing database or its directory', async () => {
	const path = join(directory, 'missing/visits.sqlite');

	await expect(openDb(path, { readOnly: true })).rejects.toThrow();
	expect(existsSync(path)).toBe(false);
	expect(existsSync(dirname(path))).toBe(false);
});
