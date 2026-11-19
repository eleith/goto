import { ConfigError, formatConfigError } from '@goto/config';

export type WorkerStartupCode =
	| 'database_open_failed'
	| 'migrations_failed'
	| 'statistics_check_failed'
	| 'workflow_database_open_failed'
	| 'workflow_start_failed'
	| 'startup_maintenance_failed'
	| 'health_server_failed'
	| 'config_monitor_failed'
	| 'startup_cleanup_failed';

export class WorkerStartupError extends Error {
	readonly code: WorkerStartupCode;

	constructor(code: WorkerStartupCode, cause: unknown) {
		super(`Unable to start worker service (${code})`, { cause });
		this.name = 'WorkerStartupError';
		this.code = code;
	}
}

export function formatWorkerStartupFailure(error: unknown): string {
	if (error instanceof ConfigError) {
		return formatConfigError(error, 'Unable to start worker service');
	}
	if (error instanceof WorkerStartupError) {
		let reason = describeStartupCause(error.cause);
		if (!reason && error.code === 'migrations_failed') {
			reason = 'Check database migration history and the deployed build';
		}
		return reason ? `${error.message}: ${reason}` : error.message;
	}
	return 'Unable to start worker service';
}

function describeStartupCause(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null || !('code' in error)) return;
	switch (error.code) {
		case 'EACCES':
		case 'EPERM':
			return 'Permission denied. Check access to the configured storage directory';
		case 'ENOENT':
			return 'A required path was not found. Check the configured storage paths';
		case 'ENOTDIR':
		case 'EISDIR':
			return 'The storage path has the wrong file type. Check database files and parent directories';
		case 'EROFS':
			return 'Storage is read-only. Check the writable data mounts';
		case 'ENOSPC':
			return 'Storage is full';
		case 'EADDRINUSE':
			return 'The health address or port is already in use. Check HOST and PORT';
		case 'EADDRNOTAVAIL':
			return 'The health listen address is unavailable. Check HOST';
		case 'ENOTFOUND':
			return 'The health listen host could not be resolved. Check HOST';
		case 'ERR_SQLITE_ERROR':
			return describeSqliteStartupFailure('errcode' in error ? error.errcode : undefined);
	}
}

function describeSqliteStartupFailure(code: unknown): string {
	switch (code) {
		case 5:
		case 6:
			return 'The database is busy or locked. Check for other processes holding a write transaction';
		case 8:
			return 'The database is read-only. Check the writable data mounts and permissions';
		case 13:
			return 'Database storage is full';
		case 11:
		case 26:
			return 'SQLite cannot read the database format. Check the database file and backups';
		case 14:
			return 'SQLite could not open the database. Check its configured path and permissions';
		case 19:
			return 'Database constraints rejected startup work. Back up the database before inspecting its data';
		default:
			return 'SQLite rejected the operation. Check database compatibility and storage access';
	}
}
