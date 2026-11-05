import { sql, type Kysely } from 'kysely';
import type { ClassifiedVisit, Database } from './types.js';

export async function insertVisit(
	db: Kysely<Database>,
	visit: ClassifiedVisit
): Promise<number | undefined> {
	const insert = sql<{ id: number }>`
		INSERT INTO visits (domain, path, visited_at, ip, user_agent, accept_language, browser, os)
		SELECT ${visit.domain}, ${visit.path}, ${visit.visited_at}, ${visit.ip},
			${visit.user_agent}, ${visit.accept_language}, ${visit.browser}, ${visit.os}
		FROM visit_collection
		WHERE id = 1 AND collect_after < ${visit.visited_at}
		RETURNING id
	`;
	const result = await insert.execute(db);
	return result.rows[0]?.id;
}

export async function setVisitCollection(
	db: Kysely<Database>,
	enabled: boolean,
	now = Date.now()
): Promise<void> {
	const collectAfter = enabled ? sql<number>`coalesce(collect_after, ${now})` : null;
	await db
		.updateTable('visit_collection')
		.set({ collect_after: collectAfter })
		.where('id', '=', 1)
		.execute();
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

export async function purgeVisitsIfDisabled(db: Kysely<Database>): Promise<void> {
	await db
		.deleteFrom('visits')
		.where((expression) => {
			const disabled = expression
				.selectFrom('visit_collection')
				.select('id')
				.where('id', '=', 1)
				.where('collect_after', 'is', null);
			return expression.exists(disabled);
		})
		.execute();
}

export async function purgeVisits(db: Kysely<Database>): Promise<void> {
	await db.deleteFrom('visits').execute();
}
