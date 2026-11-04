import type { Kysely } from 'kysely';
import type { ClassifiedVisit, Database } from './types.js';

export async function insertVisit(db: Kysely<Database>, visit: ClassifiedVisit): Promise<number> {
	const row = await db.insertInto('visits').values(visit).returning('id').executeTakeFirstOrThrow();
	return row.id;
}
