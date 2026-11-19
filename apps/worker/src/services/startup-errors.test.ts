import { ConfigError, loadConfig } from '@goto/config';
import { expect, test } from 'vitest';
import { formatWorkerStartupFailure, WorkerStartupError } from './startup-errors.js';

test('preserves curated configuration issues without authored keys or values', () => {
	let failure: unknown;
	try {
		loadConfig(
			{
				auth: { credentials: { username: 'test', password: 'private-config-password' } },
				domains: {
					'private-domain.example': {
						links: {
							'/private-link': {
								url: 'https://destination.example/private-token',
								forward_query: 'private-setting-value'
							}
						}
					}
				}
			},
			{ env: {} }
		);
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(ConfigError);
	expect(formatWorkerStartupFailure(failure)).toBe(
		'Unable to start worker service\n  /domains/*/links/*/forward_query: Expected boolean'
	);
});

test('does not trust raw errors or objects that imitate startup diagnostics', () => {
	const cause = Object.assign(new Error('private-path-and-password'), { code: 'EACCES' });
	const lookalike = {
		name: 'WorkerStartupError',
		message: 'Unable to start worker service (database_open_failed)',
		code: 'database_open_failed',
		cause
	};
	expect(formatWorkerStartupFailure(cause)).toBe('Unable to start worker service');
	expect(formatWorkerStartupFailure(lookalike)).toBe('Unable to start worker service');
	expect(formatWorkerStartupFailure('private-non-error')).toBe('Unable to start worker service');
});

test('gives generic migration advice without interpreting or revealing the cause message', () => {
	const cause = new Error('private migration name and database details');
	const error = new WorkerStartupError('migrations_failed', cause);
	expect(error.code).toBe('migrations_failed');
	expect(error.message).toBe('Unable to start worker service (migrations_failed)');
	expect(error.cause).toBe(cause);
	expect(formatWorkerStartupFailure(error)).toBe(
		'Unable to start worker service (migrations_failed): Check database migration history and the deployed build'
	);
	expect(formatWorkerStartupFailure(cause)).toBe('Unable to start worker service');
});

test('uses a filesystem reason only inside the trusted startup error', () => {
	const cause = Object.assign(new Error('EACCES: private database path'), {
		code: 'EACCES',
		path: '/private/storage/visits.sqlite',
		stack: 'private stack and credentials'
	});
	expect(formatWorkerStartupFailure(new WorkerStartupError('database_open_failed', cause))).toBe(
		'Unable to start worker service (database_open_failed): Permission denied. Check access to the configured storage directory'
	);
});

test('uses SQLite numeric reasons without emitting SQL, parameters or raw error details', () => {
	const cause = Object.assign(new Error('private database lock details'), {
		code: 'ERR_SQLITE_ERROR',
		errcode: 5,
		query: 'INSERT INTO private_table VALUES (?)',
		parameters: ['private-password']
	});
	expect(
		formatWorkerStartupFailure(new WorkerStartupError('startup_maintenance_failed', cause))
	).toBe(
		'Unable to start worker service (startup_maintenance_failed): The database is busy or locked. Check for other processes holding a write transaction'
	);
});

test('keeps the startup code but omits unknown cause messages and code values', () => {
	const cause = Object.assign(new Error('private workflow input'), {
		code: 'private-unknown-code',
		cause: new Error('private nested cause')
	});
	expect(formatWorkerStartupFailure(new WorkerStartupError('workflow_start_failed', cause))).toBe(
		'Unable to start worker service (workflow_start_failed)'
	);
});
