import type { Kysely, Migration } from 'kysely';

export const visitReports: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema
			.createTable('visit_reports')
			.addColumn('key', 'text', (column) => column.primaryKey())
			.addColumn('data', 'text', (column) => column.notNull())
			.execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.dropTable('visit_reports').execute();
	}
};
