import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Kysely } from 'kysely';
import { NodeSqliteDialect } from './node-sqlite-dialect.js';
import type { Database } from './types.js';

export { runMigrations } from './migrate.js';
export { insertVisit } from './visits.js';
export type { Database, NewVisit, Visit } from './types.js';

export async function openDb(
	path: string,
	{ readOnly = false }: { readOnly?: boolean } = {}
): Promise<Kysely<Database>> {
	if (!readOnly && path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const database = new DatabaseSync(path, { readOnly });
	try {
		if (!readOnly) {
			database.exec('PRAGMA journal_mode = WAL');
			database.exec('PRAGMA synchronous = NORMAL');
		}
		database.exec('PRAGMA foreign_keys = ON');
		database.exec('PRAGMA busy_timeout = 5000');
		const db = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database }) });
		await db.connection().execute(async () => undefined);
		return db;
	} catch (error) {
		database.close();
		throw error;
	}
}
