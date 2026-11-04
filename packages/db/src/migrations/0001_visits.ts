import type { Kysely, Migration } from 'kysely';

export const initial: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema
			.createTable('visits')
			.addColumn('id', 'integer', (column) => column.primaryKey().autoIncrement())
			.addColumn('domain', 'text', (column) => column.notNull())
			.addColumn('path', 'text', (column) => column.notNull())
			.addColumn('visited_at', 'integer', (column) => column.notNull())
			.addColumn('ip', 'text', (column) => column.notNull())
			.addColumn('user_agent', 'text')
			.addColumn('accept_language', 'text')
			.execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.dropTable('visits').execute();
	}
};
