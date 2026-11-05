import { sql, type Kysely, type Migration } from 'kysely';

export const addVisitOutcome: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await sql`ALTER TABLE visits ADD COLUMN outcome text NOT NULL DEFAULT 'valid'`.execute(db);
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await sql`ALTER TABLE visits DROP COLUMN outcome`.execute(db);
	}
};
