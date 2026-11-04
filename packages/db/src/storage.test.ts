import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { Migrator, sql, type Migration } from 'kysely';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { insertVisit, openDb, runMigrations, type ClassifiedVisit } from './index.js';
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
	visited_at: 1_700_000_000_000,
	ip: '2001:db8::1',
	user_agent: 'Mozilla/5.0 (X11; Linux x86_64; rv:158.0) Gecko/20100101 Firefox/158.0',
	accept_language: 'en-US,en;q=0.9',
	browser: 'Firefox',
	os: 'Linux'
};

test('opens a real WAL database and applies versioned migrations once', async () => {
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
		expect(await runMigrations(db)).toEqual(['0001_visits', '0002_visit_classification']);
		expect(await runMigrations(db)).toEqual([]);
	} finally {
		await db.destroy();
	}
});

test('persists classified visits for the same logical path on different domains', async () => {
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
			{ ...visit, id: ids[0] },
			{
				...visit,
				domain: 'tiny.example.test',
				id: ids[1],
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

test('adds classification columns without changing existing visit data', async () => {
	const db = await openDb(join(directory, 'legacy.sqlite'));
	try {
		const migrator = new Migrator({
			db,
			provider: {
				async getMigrations() {
					return migrations;
				}
			}
		});
		const { error } = await migrator.migrateTo('0001_visits');
		if (error) throw error;
		await sql`
			INSERT INTO visits (domain, path, visited_at, ip, user_agent, accept_language)
			VALUES (${visit.domain}, ${visit.path}, ${visit.visited_at}, ${visit.ip}, ${visit.user_agent}, ${visit.accept_language})
		`.execute(db);

		expect(await runMigrations(db)).toEqual(['0002_visit_classification']);
		expect(await db.selectFrom('visits').selectAll().executeTakeFirstOrThrow()).toEqual({
			...visit,
			id: 1,
			browser: 'Other',
			os: 'Other'
		});
	} finally {
		await db.destroy();
	}
});

test('a failed migration rolls back schema and bookkeeping so startup can retry', async () => {
	const db = await openDb(join(directory, 'failed-migration.sqlite'));
	try {
		const failure = new Error('Simulated failure after classification DDL');
		const failedClassification: Migration = {
			async up(transaction) {
				await migrations['0002_visit_classification'].up(transaction);
				throw failure;
			}
		};
		const migrator = new Migrator({
			db,
			provider: {
				async getMigrations() {
					return { ...migrations, '0002_visit_classification': failedClassification };
				}
			}
		});

		expect((await migrator.migrateToLatest()).error).toBe(failure);
		expect(await runMigrations(db)).toEqual(['0001_visits', '0002_visit_classification']);
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
