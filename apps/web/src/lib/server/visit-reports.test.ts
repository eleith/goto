import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GotoConfiguration } from '@goto/config';
import { openDb, runMigrations } from '@goto/db';
import { publishVisitReports, type PreparedVisitReport } from '@goto/db/visit-reports';
import { expect, test, vi } from 'vitest';
import { readVisitReport } from './visit-reports.js';

const report: PreparedVisitReport = {
	totals: { total: 3, valid: 2, invalid: 1, base: 1 },
	daily: [],
	weekly: [],
	monthly: [],
	browsers: [],
	operatingSystems: [],
	domainCounts: [],
	linkCounts: []
};

test('reads prepared output and hides snapshots from a different retention policy', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-page-reports-'));
	const configuration: Pick<GotoConfiguration, 'database' | 'analytics'> = {
		database: {
			path: join(directory, 'goto.sqlite'),
			worker_path: join(directory, 'worker.sqlite')
		},
		analytics: { retention_months: 3 }
	};
	try {
		const db = await openDb(configuration.database.path);
		try {
			await runMigrations(db);
			const period = {
				timezone: 'UTC' as const,
				retentionMonths: 3 as const,
				since: 100,
				asOf: 200,
				days: [],
				weeks: [],
				months: []
			};
			await publishVisitReports(db, period, [
				{ key: 'overview', data: JSON.stringify(report) },
				{ key: 'empty', data: JSON.stringify(report) }
			]);
		} finally {
			await db.destroy();
		}
		expect((await readVisitReport(configuration))?.report.totals.total).toBe(3);
		configuration.analytics.retention_months = 9;
		expect(await readVisitReport(configuration)).toBeNull();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('enabled collection fails safely without creating missing storage', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-missing-reports-'));
	const missing = join(directory, 'missing');
	const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const configuration = {
			database: {
				path: join(missing, 'goto.sqlite'),
				worker_path: join(directory, 'worker.sqlite')
			},
			analytics: { retention_months: 3 as const }
		};
		expect(await readVisitReport(configuration)).toBeNull();
		expect(warning).toHaveBeenCalledExactlyOnceWith('Prepared visit reports unavailable');
		await expect(access(missing)).rejects.toMatchObject({ code: 'ENOENT' });
	} finally {
		warning.mockRestore();
		await rm(directory, { recursive: true, force: true });
	}
});

test('disabled collection does not attempt to open missing storage', async () => {
	const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const configuration = {
			database: { path: '/missing/not-used.sqlite', worker_path: '/missing/worker.sqlite' },
			analytics: { retention_months: 0 as const }
		};
		expect(await readVisitReport(configuration)).toBeNull();
		expect(warning).not.toHaveBeenCalled();
	} finally {
		warning.mockRestore();
	}
});
