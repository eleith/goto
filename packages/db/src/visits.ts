import type { Kysely } from 'kysely';
import type { ClassifiedVisit, Database } from './types.js';

export async function insertVisit(db: Kysely<Database>, visit: ClassifiedVisit): Promise<number> {
	const row = await db.insertInto('visits').values(visit).returning('id').executeTakeFirstOrThrow();
	return row.id;
}

export async function pruneVisits(db: Kysely<Database>, before: number): Promise<boolean> {
	const batchSize = 1000;
	const expired = db
		.selectFrom('visits')
		.select('id')
		.where('visited_at', '<', before)
		.orderBy('visited_at')
		.orderBy('id')
		.limit(batchSize);
	const result = await db.deleteFrom('visits').where('id', 'in', expired).executeTakeFirstOrThrow();
	return result.numDeletedRows === BigInt(batchSize);
}

export async function purgeVisits(db: Kysely<Database>): Promise<void> {
	await db.deleteFrom('visits').execute();
}
