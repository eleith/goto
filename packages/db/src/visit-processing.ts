import { sql, type Kysely } from 'kysely';
import type { Database, Visit } from './types.js';

const batchSize = 1000;

export async function captureVisitBoundary(db: Kysely<Database>): Promise<number> {
	const row = await db
		.selectFrom('visits')
		.select(({ fn }) => fn.max<number>('id').as('throughId'))
		.executeTakeFirstOrThrow();
	return row.throughId ?? 0;
}

export async function processVisitBatch(
	db: Kysely<Database>,
	{ throughId, asOf }: { throughId: number; asOf: number },
	applyStatistics: (transaction: Kysely<Database>, visits: Visit[]) => Promise<void>
): Promise<boolean> {
	return db.transaction().execute(async (transaction) => {
		await reserveVisitWriter(transaction);
		const visits = await transaction
			.selectFrom('visits')
			.selectAll()
			.where('processed', '=', 0)
			.where('id', '<=', throughId)
			.where('visited_at', '<', asOf)
			.orderBy('id')
			.limit(batchSize)
			.execute();
		if (visits.length === 0) return false;
		await applyStatistics(transaction, visits);
		await transaction
			.updateTable('visits')
			.set({ processed: 1 })
			.where(
				'id',
				'in',
				visits.map(({ id }) => id)
			)
			.execute();
		return visits.length === batchSize;
	});
}

export async function deleteExpiredVisitBatch(
	db: Kysely<Database>,
	{ throughId, before }: { throughId: number; before: number },
	removeRetainedStatistics: (transaction: Kysely<Database>, visits: Visit[]) => Promise<void>
): Promise<boolean> {
	return db.transaction().execute(async (transaction) => {
		await reserveVisitWriter(transaction);
		const visits = await transaction
			.selectFrom('visits')
			.selectAll()
			.where('processed', '=', 1)
			.where('id', '<=', throughId)
			.where('visited_at', '<', before)
			.orderBy('visited_at')
			.orderBy('id')
			.limit(batchSize)
			.execute();
		if (visits.length === 0) return false;
		await removeRetainedStatistics(transaction, visits);
		await transaction
			.deleteFrom('visits')
			.where(
				'id',
				'in',
				visits.map(({ id }) => id)
			)
			.execute();
		return visits.length === batchSize;
	});
}

async function reserveVisitWriter(db: Kysely<Database>): Promise<void> {
	await db
		.updateTable('visits')
		.set({ processed: sql`processed` })
		.where('id', '=', -1)
		.execute();
}
