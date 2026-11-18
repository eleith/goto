import { sql, type Kysely, type Migration } from 'kysely';

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
			.addColumn('browser', 'text', (column) => column.notNull().defaultTo('Other'))
			.addColumn('os', 'text', (column) => column.notNull().defaultTo('Other'))
			.addColumn('outcome', 'text', (column) => column.notNull().defaultTo('valid'))
			.addColumn('processed', 'integer', (column) => column.notNull().defaultTo(0))
			.addCheckConstraint('visits_processed', sql`processed IN (0, 1)`)
			.execute();
		await db.schema.createIndex('visits_visited_at').on('visits').column('visited_at').execute();
		await sql`CREATE INDEX visits_pending_id ON visits (id) WHERE processed = 0`.execute(db);
		await db.schema
			.createTable('visit_daily_statistics')
			.addColumn('id', 'integer', (column) => column.primaryKey())
			.addColumn('scope_kind', 'text', (column) => column.notNull())
			.addColumn('domain', 'text')
			.addColumn('path', 'text')
			.addColumn('day', 'text', (column) => column.notNull())
			.addColumn('valid_visits', 'integer', (column) => column.notNull())
			.addColumn('invalid_visits', 'integer', (column) => column.notNull())
			.addColumn('last_visit_at', 'integer', (column) => column.notNull())
			.addColumn('browsers_json', 'text', (column) => column.notNull())
			.addColumn('operating_systems_json', 'text', (column) => column.notNull())
			.addColumn('accepted_languages_json', 'text', (column) => column.notNull())
			.addCheckConstraint(
				'visit_daily_statistics_scope',
				sql`
				(scope_kind = 'overview' AND domain IS NULL AND path IS NULL) OR
				(scope_kind = 'domain' AND domain IS NOT NULL AND length(domain) > 0 AND path IS NULL) OR
				(scope_kind = 'link' AND domain IS NOT NULL AND length(domain) > 0
					AND path IS NOT NULL AND substr(path, 1, 1) = '/')`
			)
			.addCheckConstraint(
				'visit_daily_statistics_day',
				sql`
				day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
				AND date(day, '+0 days') IS NOT NULL AND date(day, '+0 days') = day`
			)
			.addCheckConstraint(
				'visit_daily_statistics_counts',
				sql`
				typeof(valid_visits) = 'integer' AND valid_visits BETWEEN 0 AND 9007199254740991
				AND typeof(invalid_visits) = 'integer' AND invalid_visits BETWEEN 0 AND 9007199254740991
				AND (valid_visits > 0 OR invalid_visits > 0)`
			)
			.addCheckConstraint(
				'visit_daily_statistics_activity',
				sql`
				typeof(last_visit_at) = 'integer'
				AND last_visit_at BETWEEN -62167219200000 AND 253402300799999
				AND date(last_visit_at / 1000.0, 'unixepoch') = day`
			)
			.addCheckConstraint(
				'visit_daily_statistics_browsers',
				sql`json_valid(browsers_json) AND json_type(browsers_json) = 'array'`
			)
			.addCheckConstraint(
				'visit_daily_statistics_os',
				sql`json_valid(operating_systems_json) AND json_type(operating_systems_json) = 'array'`
			)
			.addCheckConstraint(
				'visit_daily_statistics_languages',
				sql`json_valid(accepted_languages_json) AND json_type(accepted_languages_json) = 'array'`
			)
			.execute();
		await sql`CREATE UNIQUE INDEX visit_daily_statistics_overview
			ON visit_daily_statistics (day) WHERE scope_kind = 'overview'`.execute(db);
		await sql`CREATE UNIQUE INDEX visit_daily_statistics_domain
			ON visit_daily_statistics (domain, day) WHERE scope_kind = 'domain'`.execute(db);
		await sql`CREATE UNIQUE INDEX visit_daily_statistics_link
			ON visit_daily_statistics (domain, path, day) WHERE scope_kind = 'link'`.execute(db);
		await db.schema
			.createIndex('visit_daily_statistics_last_visit_at')
			.on('visit_daily_statistics')
			.column('last_visit_at')
			.execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.dropTable('visit_daily_statistics').execute();
		await db.schema.dropTable('visits').execute();
	}
};
