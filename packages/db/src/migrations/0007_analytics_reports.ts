import { sql, type Kysely, type Migration } from 'kysely';

export const analyticsReports: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema
			.createTable('analytics_reports')
			.addColumn('id', 'integer', (column) => column.primaryKey())
			.addColumn('scope_kind', 'text', (column) => column.notNull())
			.addColumn('domain', 'text')
			.addColumn('path', 'text')
			.addColumn('summary_json', 'text', (column) => column.notNull())
			.addColumn('details_json', 'text', (column) => column.notNull())
			.addCheckConstraint(
				'analytics_reports_scope',
				sql`
				(scope_kind = 'overview' AND domain IS NULL AND path IS NULL) OR
				(scope_kind = 'domain' AND domain IS NOT NULL AND length(domain) > 0 AND path IS NULL) OR
				(scope_kind = 'link' AND domain IS NOT NULL AND length(domain) > 0
					AND path IS NOT NULL AND substr(path, 1, 1) = '/')
			`
			)
			.addCheckConstraint('analytics_reports_summary_json', sql`json_valid(summary_json)`)
			.addCheckConstraint('analytics_reports_details_json', sql`json_valid(details_json)`)
			.execute();
		await sql`CREATE UNIQUE INDEX analytics_reports_overview
			ON analytics_reports (scope_kind) WHERE scope_kind = 'overview'`.execute(db);
		await sql`CREATE UNIQUE INDEX analytics_reports_domain
			ON analytics_reports (domain) WHERE scope_kind = 'domain'`.execute(db);
		await sql`CREATE UNIQUE INDEX analytics_reports_link
			ON analytics_reports (domain, path) WHERE scope_kind = 'link'`.execute(db);
		await db.schema.dropTable('visit_reports').execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.dropTable('analytics_reports').execute();
		await db.schema
			.createTable('visit_reports')
			.addColumn('key', 'text', (column) => column.primaryKey())
			.addColumn('data', 'text', (column) => column.notNull())
			.execute();
	}
};
