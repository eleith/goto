import {
	sql,
	SqliteAdapter,
	SqliteDialect,
	type Kysely,
	type MigrationLockOptions,
	type SqliteDatabase,
	type SqliteStatement
} from 'kysely';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

export interface NodeSqliteDialectConfig {
	database: DatabaseSync;
}

function adaptDatabase(database: DatabaseSync): SqliteDatabase {
	return {
		close: () => database.close(),
		prepare(sql): SqliteStatement {
			const statement = database.prepare(sql);
			return {
				reader: statement.columns().length > 0,
				all: (parameters) => statement.all(...(parameters as SQLInputValue[])),
				run: (parameters) => statement.run(...(parameters as SQLInputValue[])),
				iterate: (parameters) => statement.iterate(...(parameters as SQLInputValue[]))
			};
		}
	};
}

class NodeSqliteAdapter extends SqliteAdapter {
	override get supportsTransactionalDdl(): boolean {
		return true;
	}

	override async acquireMigrationLock(
		db: Kysely<unknown>,
		options: MigrationLockOptions
	): Promise<void> {
		const name = options.lockTableSchema
			? `${options.lockTableSchema}.${options.lockTable}`
			: options.lockTable;
		const table = sql.table(name);
		// Reserve the SQLite writer before Kysely reads migration history.
		const lock = sql`UPDATE ${table} SET is_locked = 0 WHERE id = ${options.lockRowId}`;
		await lock.execute(db);
	}
}

export class NodeSqliteDialect extends SqliteDialect {
	constructor(config: NodeSqliteDialectConfig) {
		// Native connection ownership keeps other requests out of an active transaction.
		super({ database: adaptDatabase(config.database) });
	}

	override createAdapter(): SqliteAdapter {
		return new NodeSqliteAdapter();
	}
}
