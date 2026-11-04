import { sql, type Kysely, type Migration } from 'kysely';

export const addVisitClassification: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await sql`ALTER TABLE visits ADD COLUMN browser text NOT NULL DEFAULT 'Other'`.execute(db);
		await sql`ALTER TABLE visits ADD COLUMN os text NOT NULL DEFAULT 'Other'`.execute(db);
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await sql`ALTER TABLE visits DROP COLUMN os`.execute(db);
		await sql`ALTER TABLE visits DROP COLUMN browser`.execute(db);
	}
};
