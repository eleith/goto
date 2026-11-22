import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
	createVisitPeriod,
	visitDays,
	type DailyVisitStatistics,
	type VisitDetails
} from '@goto/analytics';
import type { GotoConfiguration } from '@goto/config';
import { openDb, runMigrations } from '@goto/db';
import { addDailyVisitStatistics } from '@goto/db/visit-reports';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	readDomainDetails,
	readLinkDetails,
	readVisitDetails,
	readLastActivity
} from './reports.js';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

test('reads daily output and derives zero scopes in a window from current time and configured retention', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-page-reports-'));
	const configuration: Pick<GotoConfiguration, 'database' | 'analytics'> = {
		database: {
			path: join(directory, 'goto.sqlite'),
			worker_path: join(directory, 'worker.sqlite')
		},
		analytics: { retention_months: 3 }
	};
	const period = createVisitPeriod(3, Date.now());
	const totals = { validVisits: 2, invalidVisits: 1 };
	const lastActivityAt = '2026-06-15T10:00:00.000Z';
	const details: VisitDetails = {
		version: 5,
		scope: { kind: 'overview' },
		period,
		lastActivityAt,
		daily: visitDays(period).map((day) => ({
			...day,
			validVisits: day.start.startsWith('2026-06-15') ? totals.validVisits : 0,
			invalidVisits: day.start.startsWith('2026-06-15') ? totals.invalidVisits : 0
		})),
		browsers: [{ day: '2026-06-15', name: 'Other', ...totals }],
		operatingSystems: [{ day: '2026-06-15', name: 'Other', ...totals }],
		acceptedLanguages: [{ day: '2026-06-15', name: 'Other', ...totals }]
	};
	const daily: DailyVisitStatistics = {
		scope: details.scope,
		day: '2026-06-15',
		lastVisitAt: Date.parse(lastActivityAt),
		...totals,
		browsers: [{ name: 'Other', ...totals }],
		operatingSystems: [{ name: 'Other', ...totals }],
		acceptedLanguages: [{ name: 'Other', ...totals }]
	};
	const domain = 'go.example.test';
	const domainScope = { kind: 'domain', domain } as const;
	const domainDetails: VisitDetails = { ...details, scope: domainScope };
	const linkScope = { kind: 'link', domain, path: '/docs' } as const;
	const linkDetails: VisitDetails = { ...details, scope: linkScope };
	const emptyDetails: VisitDetails = {
		...details,
		lastActivityAt: null,
		daily: visitDays(period).map((day) => ({ ...day, validVisits: 0, invalidVisits: 0 })),
		browsers: [],
		operatingSystems: [],
		acceptedLanguages: []
	};
	try {
		const db = await openDb(configuration.database.path);
		try {
			await runMigrations(db);
			expect(await readVisitDetails(configuration, linkScope)).toEqual({
				...emptyDetails,
				scope: linkScope
			});
			expect(await readLastActivity(configuration)).toEqual({
				available: true,
				lastActivityAt: null
			});
			await db
				.transaction()
				.execute((transaction) =>
					addDailyVisitStatistics(transaction, [
						daily,
						{ ...daily, scope: domainScope },
						{ ...daily, scope: linkScope }
					])
				);
		} finally {
			await db.destroy();
		}
		const close = vi.spyOn(DatabaseSync.prototype, 'close');
		try {
			expect(await readVisitDetails(configuration, details.scope)).toEqual(details);
			expect(close).toHaveBeenCalledTimes(1);
			expect(await readDomainDetails(configuration, domain, ['/docs', '/new'])).toEqual({
				domain: domainDetails,
				links: [
					{ path: '/', details: { ...emptyDetails, scope: { ...linkScope, path: '/' } } },
					{ path: '/docs', details: linkDetails },
					{ path: '/new', details: { ...emptyDetails, scope: { ...linkScope, path: '/new' } } }
				]
			});
			expect(close).toHaveBeenCalledTimes(2);
			expect(await readVisitDetails(configuration, linkScope)).toEqual(linkDetails);
			expect(close).toHaveBeenCalledTimes(3);
			expect(
				await readLinkDetails(configuration, [linkScope, { domain, path: '/missing' }])
			).toEqual({
				period,
				links: [
					{ domain, path: '/docs', details: linkDetails },
					{
						domain,
						path: '/missing',
						details: { ...emptyDetails, scope: { ...linkScope, path: '/missing' } }
					}
				]
			});
			expect(close).toHaveBeenCalledTimes(4);
			expect(await readLastActivity(configuration)).toEqual({ available: true, lastActivityAt });
			expect(close).toHaveBeenCalledTimes(5);
			configuration.analytics.retention_months = 9;
			const longerPeriod = createVisitPeriod(9, Date.now());
			expect((await readVisitDetails(configuration, details.scope))?.period).toEqual(longerPeriod);
			expect((await readDomainDetails(configuration, domain, ['/docs']))?.domain.period).toEqual(
				longerPeriod
			);
			expect((await readVisitDetails(configuration, linkScope))?.period).toEqual(longerPeriod);
			expect((await readLinkDetails(configuration, [linkScope]))?.period).toEqual(longerPeriod);
			vi.setSystemTime(new Date('2027-06-15T12:00:00.000Z'));
			const advanced = await readVisitDetails(configuration, linkScope);
			expect(advanced?.period).toEqual(createVisitPeriod(9, Date.now()));
			expect(advanced?.lastActivityAt).toBeNull();
			expect(
				advanced?.daily.every(
					({ validVisits, invalidVisits }) => validVisits === 0 && invalidVisits === 0
				)
			).toBe(true);
			expect(await readLastActivity(configuration)).toEqual({
				available: true,
				lastActivityAt: null
			});
		} finally {
			close.mockRestore();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('corrupt daily histograms are unavailable, sanitized and closed; activity uses only MAX', async () => {
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
			const corruptDay = {
				day: '2026-06-15',
				last_visit_at: Date.parse('2026-06-15T10:00:00.000Z'),
				valid_visits: 1,
				invalid_visits: 0,
				browsers_json: '[{"private":"not-for-browser"}]',
				operating_systems_json: '[{"name":"Other","validVisits":1,"invalidVisits":0}]',
				accepted_languages_json: '[{"name":"Other","validVisits":1,"invalidVisits":0}]'
			};
			await db
				.insertInto('visit_daily_statistics')
				.values([
					{ ...corruptDay, scope_kind: 'overview', domain: null, path: null },
					{ ...corruptDay, scope_kind: 'domain', domain: 'go.example.test', path: null },
					{ ...corruptDay, scope_kind: 'link', domain: 'go.example.test', path: '/docs' }
				])
				.execute();
		} finally {
			await db.destroy();
		}
		const close = vi.spyOn(DatabaseSync.prototype, 'close');
		try {
			expect(await readVisitDetails(configuration, { kind: 'overview' })).toBeNull();
			expect(close).toHaveBeenCalledTimes(1);
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
			expect(
				await readLinkDetails(configuration, [{ domain: 'go.example.test', path: '/docs' }])
			).toBeNull();
			expect(close).toHaveBeenCalledTimes(4);
			expect(warning.mock.calls).toEqual(
				Array.from({ length: 4 }, () => ['Prepared visit reports unavailable'])
			);
			expect(await readLastActivity(configuration)).toEqual({
				available: true,
				lastActivityAt: '2026-06-15T10:00:00.000Z'
			});
			expect(close).toHaveBeenCalledTimes(5);
		} finally {
			close.mockRestore();
		}
	} finally {
		warning.mockRestore();
		await rm(directory, { recursive: true, force: true });
	}
});

test('a missing daily table remains unavailable without readonly schema repair', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-missing-table-'));
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
		await db.destroy();
		expect(await readVisitDetails(configuration, { kind: 'overview' })).toBeNull();
		expect(await readLastActivity(configuration)).toEqual({
			available: false,
			lastActivityAt: null
		});
		const storage = new DatabaseSync(configuration.database.path, { readOnly: true });
		try {
			expect(storage.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all()).toEqual(
				[]
			);
		} finally {
			storage.close();
		}
		expect(warning.mock.calls).toEqual([
			['Prepared visit reports unavailable'],
			['Prepared visit reports unavailable']
		]);
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
		expect(await readVisitDetails(configuration, { kind: 'overview' })).toBeNull();
		expect(await readDomainDetails(configuration, 'go.example.test', ['/docs'])).toBeNull();
		expect(
			await readLinkDetails(configuration, [{ domain: 'go.example.test', path: '/docs' }])
		).toBeNull();
		expect(await readLastActivity(configuration)).toEqual({
			available: false,
			lastActivityAt: null
		});
		expect(warning.mock.calls).toEqual(
			Array.from({ length: 4 }, () => ['Prepared visit reports unavailable'])
		);
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
		expect(await readVisitDetails(configuration, { kind: 'overview' })).toBeNull();
		expect(await readDomainDetails(configuration, 'go.example.test', ['/docs'])).toBeNull();
		expect(
			await readLinkDetails(configuration, [{ domain: 'go.example.test', path: '/docs' }])
		).toBeNull();
		expect(await readLastActivity(configuration)).toEqual({
			available: true,
			lastActivityAt: null
		});
		expect(warning).not.toHaveBeenCalled();
	} finally {
		warning.mockRestore();
	}
});
