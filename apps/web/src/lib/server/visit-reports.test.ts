import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
import { readOverviewDetails, readDomainDetails, readVisitDetails } from './visit-reports.js';

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
		version: 2,
		scope: summary.scope,
		period,
		daily: days.map((day, index) => ({
			...day,
			validVisits: index === days.length - 1 ? totals.validVisits : 0,
			invalidVisits: index === days.length - 1 ? totals.invalidVisits : 0
		})),
		browsers: [{ day: period.asOf.slice(0, 10), name: 'Other', ...totals }],
		operatingSystems: [{ day: period.asOf.slice(0, 10), name: 'Other', ...totals }]
	};
	const domain = 'go.example.test';
	const domainScope = { kind: 'domain', domain } as const;
	const domainDetails: VisitDetails = { ...details, scope: domainScope };
	const linkScope = { kind: 'link', domain, path: '/docs' } as const;
	const linkDetails: VisitDetails = { ...details, scope: linkScope };
	try {
		const db = await openDb(configuration.database.path);
		try {
			await runMigrations(db);
			expect(await readOverviewDetails(configuration, [domain])).toBeNull();
			expect(await readDomainDetails(configuration, domain, ['/docs'])).toBeNull();
			expect(await readVisitDetails(configuration, linkScope)).toBeNull();
			await publishVisitReports(
				db,
				encodeVisitReports([
					{ summary, details },
					{
						summary: {
							version: 1,
							scope: domainScope,
							period,
							totals,
							base: { validVisits: 0, invalidVisits: 0 },
							links: []
						},
						details: domainDetails
					},
					{
						summary: { version: 1, scope: linkScope, period, totals },
						details: linkDetails
					}
				])
			);
		} finally {
			await db.destroy();
		}
		const close = vi.spyOn(DatabaseSync.prototype, 'close');
		try {
			expect(await readOverviewDetails(configuration, [domain, 'new.example.test'])).toEqual({
				overview: details,
				domains: [{ domain, details: domainDetails }]
			});
			expect(close).toHaveBeenCalledTimes(1);
			expect(await readDomainDetails(configuration, domain, ['/docs', '/new'])).toEqual({
				domain: domainDetails,
				links: [{ path: '/docs', details: linkDetails }]
			});
			expect(close).toHaveBeenCalledTimes(2);
			expect(await readVisitDetails(configuration, linkScope)).toEqual(linkDetails);
			expect(close).toHaveBeenCalledTimes(3);
			expect(await readVisitDetails(configuration, { ...linkScope, path: '/missing' })).toBeNull();
			expect(close).toHaveBeenCalledTimes(4);
			configuration.analytics.retention_months = 9;
			expect(await readOverviewDetails(configuration, ['go.example.test'])).toBeNull();
			expect(close).toHaveBeenCalledTimes(5);
			expect(await readDomainDetails(configuration, domain, ['/docs'])).toBeNull();
			expect(close).toHaveBeenCalledTimes(6);
			expect(await readVisitDetails(configuration, linkScope)).toBeNull();
			expect(close).toHaveBeenCalledTimes(7);
		} finally {
			close.mockRestore();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('invalid prepared output is unavailable, sanitized and closed', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-invalid-reports-'));
	const configuration = {
		database: {
			path: join(directory, 'goto.sqlite'),
			worker_path: join(directory, 'worker.sqlite')
		},
		analytics: { retention_months: 3 as const }
	};
	const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const db = await openDb(configuration.database.path);
		try {
			await runMigrations(db);
			await db
				.insertInto('analytics_reports')
				.values([
					{
						scope_kind: 'overview',
						domain: null,
						path: null,
						summary_json: '{"private":"not-for-browser"}',
						details_json: '{}'
					},
					{
						scope_kind: 'domain',
						domain: 'go.example.test',
						path: null,
						summary_json: '{"private":"not-for-browser"}',
						details_json: '{}'
					},
					{
						scope_kind: 'link',
						domain: 'go.example.test',
						path: '/docs',
						summary_json: '{"private":"not-for-browser"}',
						details_json: '{"private":"not-for-browser"}'
					}
				])
				.execute();
		} finally {
			await db.destroy();
		}
		const close = vi.spyOn(DatabaseSync.prototype, 'close');
		try {
			expect(await readOverviewDetails(configuration, ['go.example.test'])).toBeNull();
			expect(close).toHaveBeenCalledTimes(1);
			expect(warning).toHaveBeenCalledExactlyOnceWith('Prepared visit reports unavailable');
			expect(await readDomainDetails(configuration, 'go.example.test', ['/docs'])).toBeNull();
			expect(close).toHaveBeenCalledTimes(2);
			expect(
				await readVisitDetails(configuration, {
					kind: 'link',
					domain: 'go.example.test',
					path: '/docs'
				})
			).toBeNull();
			expect(close).toHaveBeenCalledTimes(3);
			expect(warning.mock.calls).toEqual([
				['Prepared visit reports unavailable'],
				['Prepared visit reports unavailable'],
				['Prepared visit reports unavailable']
			]);
		} finally {
			close.mockRestore();
		}
	} finally {
		warning.mockRestore();
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
		expect(
			await readVisitDetails(configuration, {
				kind: 'link',
				domain: 'go.example.test',
				path: '/docs'
			})
		).toBeNull();
		expect(await readOverviewDetails(configuration, ['go.example.test'])).toBeNull();
		expect(await readDomainDetails(configuration, 'go.example.test', ['/docs'])).toBeNull();
		expect(warning.mock.calls).toEqual([
			['Prepared visit reports unavailable'],
			['Prepared visit reports unavailable'],
			['Prepared visit reports unavailable']
		]);
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
		expect(
			await readVisitDetails(configuration, {
				kind: 'link',
				domain: 'go.example.test',
				path: '/docs'
			})
		).toBeNull();
		expect(await readOverviewDetails(configuration, ['go.example.test'])).toBeNull();
		expect(await readDomainDetails(configuration, 'go.example.test', ['/docs'])).toBeNull();
		expect(warning).not.toHaveBeenCalled();
	} finally {
		warning.mockRestore();
	}
});
