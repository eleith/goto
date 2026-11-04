import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { sql } from 'kysely';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { insertVisit, openDb, runMigrations, type NewVisit } from './index.js';

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'goto-db-'));
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

const visit: NewVisit = {
	domain: 'go.example.test',
	path: '/café',
	visited_at: 1_700_000_000_000,
	ip: '2001:db8::1',
	user_agent: 'Storage test agent',
	accept_language: 'en-US,en;q=0.9'
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
		expect(await runMigrations(db)).toEqual(['0001_visits']);
		expect(await runMigrations(db)).toEqual([]);
	} finally {
		await db.destroy();
	}
});

test('persists distinct raw visits for the same logical path on different domains', async () => {
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
				accept_language: null
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
				accept_language: null
			}
		]);
		await expect(insertVisit(reader, visit)).rejects.toThrow();
	} finally {
		await reader.destroy();
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
