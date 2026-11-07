import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createVisitPeriod,
	encodeVisitReports,
	visitDays,
	type OverviewSummary,
	type VisitDetails
} from '@goto/analytics';
import type { GotoConfiguration } from '@goto/config';
import { openDb, runMigrations } from '@goto/db';
import { publishVisitReports } from '@goto/db/visit-reports';
import { expect, test, vi } from 'vitest';
import { readVisitSummary } from './visit-reports.js';

test('reads prepared output and hides snapshots from a different retention policy', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-page-reports-'));
	const configuration: Pick<GotoConfiguration, 'database' | 'analytics'> = {
		database: {
			path: join(directory, 'goto.sqlite'),
			worker_path: join(directory, 'worker.sqlite')
		},
		analytics: { retention_months: 3 }
	};
	const period = createVisitPeriod(3, Date.parse('2026-06-15T12:00:00.000Z'));
	const totals = { validVisits: 2, invalidVisits: 1 };
	const summary: OverviewSummary = {
		version: 1,
		scope: { kind: 'overview' },
		period,
		totals,
		base: { validVisits: 1, invalidVisits: 0 },
		domains: [{ domain: 'go.example.test', totals }]
	};
	const days = visitDays(period);
	const details: VisitDetails = {
		version: 1,
		scope: summary.scope,
		period,
		daily: days.map((day, index) => ({
			...day,
			validVisits: index === days.length - 1 ? totals.validVisits : 0,
			invalidVisits: index === days.length - 1 ? totals.invalidVisits : 0
		})),
		browsers: [{ family: 'Other', ...totals }],
		operatingSystems: [{ family: 'Other', ...totals }]
	};
	try {
		const db = await openDb(configuration.database.path);
		try {
			await runMigrations(db);
			await publishVisitReports(db, encodeVisitReports([{ summary, details }]));
		} finally {
			await db.destroy();
		}
		expect(await readVisitSummary(configuration, { kind: 'overview' })).toEqual(summary);
		configuration.analytics.retention_months = 9;
		expect(await readVisitSummary(configuration, { kind: 'overview' })).toBeNull();
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
		expect(await readVisitSummary(configuration, { kind: 'overview' })).toBeNull();
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
		expect(await readVisitSummary(configuration, { kind: 'overview' })).toBeNull();
		expect(warning).not.toHaveBeenCalled();
	} finally {
		warning.mockRestore();
	}
});
