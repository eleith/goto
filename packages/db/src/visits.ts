import type { Kysely } from 'kysely';
import type { Database, NewVisit } from './types.js';

export async function insertVisit(db: Kysely<Database>, visit: NewVisit): Promise<number> {
	const row = await db.insertInto('visits').values(visit).returning('id').executeTakeFirstOrThrow();
	return row.id;
}
