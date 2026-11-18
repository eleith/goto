import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { GotoConfiguration } from '@goto/config';
import { addVisitTotals, insertVisit, openDb, runMigrations } from '@goto/db';
import { expect, test, vi } from 'vitest';
import { readLifetimeVisitTotals } from './totals.js';

test('reads only prepared lifetime visit totals at zero retention and closes each readonly connection', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-lifetime-visits-'));
	const configuration: Pick<GotoConfiguration, 'database' | 'analytics'> = {
		database: {
			path: join(directory, 'goto.sqlite'),
			worker_path: join(directory, 'worker.sqlite')
		},
		analytics: { retention_months: 0 }
	};
	const totals = { validVisits: 42, invalidVisits: 9 };
	try {
		const db = await openDb(configuration.database.path);
		try {
			await runMigrations(db);
			await db
				.transaction()
				.execute((transaction) =>
					addVisitTotals(transaction, [{ scope: { kind: 'overview' }, totals }])
				);
			await insertVisit(db, {
				domain: 'go.example.test',
				path: '/docs',
				outcome: 'valid',
				visited_at: Date.now(),
				ip: null,
				user_agent: null,
				accept_language: null,
				browser: 'Other',
				os: 'Other'
			});
		} finally {
			await db.destroy();
		}
		const close = vi.spyOn(DatabaseSync.prototype, 'close');
		try {
			expect(await readLifetimeVisitTotals(configuration, { kind: 'overview' })).toEqual(totals);
			expect(close).toHaveBeenCalledTimes(1);
			expect(
				await readLifetimeVisitTotals(configuration, {
					kind: 'link',
					domain: 'go.example.test',
					path: '/docs'
				})
			).toEqual({ validVisits: 0, invalidVisits: 0 });
			expect(close).toHaveBeenCalledTimes(2);
		} finally {
			close.mockRestore();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('missing prepared visit schema is unavailable without repair and logs no database details', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-unprepared-visits-'));
	const configuration = {
		database: {
			path: join(directory, 'private-visit-database.sqlite'),
			worker_path: join(directory, 'worker.sqlite')
		}
	};
	const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const empty = new DatabaseSync(configuration.database.path);
		empty.close();
		const close = vi.spyOn(DatabaseSync.prototype, 'close');
		try {
			expect(await readLifetimeVisitTotals(configuration, { kind: 'overview' })).toBeNull();
			expect(close).toHaveBeenCalledTimes(1);
		} finally {
			close.mockRestore();
		}
		expect(warning.mock.calls).toEqual([['Prepared lifetime visit totals unavailable']]);
		const storage = new DatabaseSync(configuration.database.path, { readOnly: true });
		try {
			expect(storage.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all()).toEqual(
				[]
			);
		} finally {
			storage.close();
		}
	} finally {
		warning.mockRestore();
		await rm(directory, { recursive: true, force: true });
	}
});

test('missing visit storage remains unavailable at zero retention without creating files or directories', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-missing-visits-'));
	const missing = join(directory, 'missing');
	const configuration = {
		database: {
			path: join(missing, 'goto.sqlite'),
			worker_path: join(directory, 'worker.sqlite')
		},
		analytics: { retention_months: 0 as const }
	};
	const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		expect(await readLifetimeVisitTotals(configuration, { kind: 'overview' })).toBeNull();
		expect(warning.mock.calls).toEqual([['Prepared lifetime visit totals unavailable']]);
		await expect(access(missing)).rejects.toMatchObject({ code: 'ENOENT' });
	} finally {
		warning.mockRestore();
		await rm(directory, { recursive: true, force: true });
	}
});
