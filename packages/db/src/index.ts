import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Kysely } from 'kysely';
import { NodeSqliteDialect } from './node-sqlite-dialect.js';
import type { Database } from './types.js';

export { runMigrations } from './migrate.js';
export { insertVisit, purgeVisits } from './visits.js';
export {
	addVisitTotals,
	readLifetimeVisitTotals,
	readOverviewLifetimeVisitTotals,
	readDomainLifetimeVisitTotals,
	readLinkVisitCountsIncludingPending
} from './visit-totals.js';
export {
	captureVisitBoundary,
	processVisitBatch,
	deleteExpiredVisitBatch,
	deleteProcessedVisitBatch
} from './visit-processing.js';
export type { ClassifiedVisit, Database, NewVisit, Visit, VisitOutcome } from './types.js';

export async function openDb(
	path: string,
	{ readOnly = false }: { readOnly?: boolean } = {}
): Promise<Kysely<Database>> {
	if (!readOnly && path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const database = new DatabaseSync(path, { readOnly });
	try {
		database.exec('PRAGMA busy_timeout = 5000');
		if (!readOnly) {
			database.exec('PRAGMA journal_mode = WAL');
			database.exec('PRAGMA synchronous = NORMAL');
		}
		database.exec('PRAGMA foreign_keys = ON');
		const db = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database }) });
		await db.connection().execute(async () => undefined);
		return db;
	} catch (error) {
		database.close();
		throw error;
	}
}
