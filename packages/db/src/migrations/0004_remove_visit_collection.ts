import { sql, type Kysely, type Migration } from 'kysely';

export const removeVisitCollection: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema.dropTable('visit_collection').execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema
			.createTable('visit_collection')
			.addColumn('id', 'integer', (column) => column.primaryKey())
			.addColumn('collect_after', 'integer')
			.execute();
		await sql`INSERT INTO visit_collection (id, collect_after) VALUES (1, 0)`.execute(db);
	}
};
