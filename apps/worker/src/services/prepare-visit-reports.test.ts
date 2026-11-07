import { validateConfig } from '@goto/config';
import { openDb, runMigrations, insertVisit, pruneVisits, type ClassifiedVisit } from '@goto/db';
import { readPreparedVisitReports } from '@goto/db/visit-reports';
import { afterEach, expect, test, vi } from 'vitest';
import { prepareVisitReports } from './prepare-visit-reports.js';
import type { WorkerContext } from './context.js';

vi.mock('@goto/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@goto/db')>();
	return { ...actual, pruneVisits: vi.fn(actual.pruneVisits) };
});

afterEach(() => vi.mocked(pruneVisits).mockReset());

async function context(): Promise<WorkerContext> {
	const prepared = validateConfig(
		{
			auth: { credentials: { username: 'test', password: 'prepare-test-password' } },
			domains: { 'go.example.test': { links: { '/docs': { url: 'https://example.test/docs' } } } }
		},
		{ env: {} }
	);
	const db = await openDb(':memory:');
	await runMigrations(db);
	return { config: prepared.configuration, domains: prepared.domains, db };
}
const visit: ClassifiedVisit = {
	domain: 'go.example.test',
	path: '/docs',
	outcome: 'valid' as const,
	visited_at: 1,
	ip: '127.0.0.1',
	user_agent: null,
	accept_language: null,
	browser: 'Firefox',
	os: 'Linux'
};

function sum(values: { total: number }[]): number {
	return values.reduce((total, value) => total + value.total, 0);
}

test('one refresh publishes all scopes and chart resolutions, excludes/deletes expired data and is repeatable', async () => {
	const ctx = await context();
	try {
		const now = Date.parse('2026-05-31T12:00:00Z');
		const cutoff = Date.parse('2026-02-28T12:00:00Z');
		await ctx.db
			.insertInto('visits')
			.values(Array.from({ length: 1001 }, () => ({ ...visit, visited_at: cutoff - 1 })))
			.execute();
		await insertVisit(ctx.db, { ...visit, visited_at: cutoff });
		await insertVisit(ctx.db, { ...visit, path: '/', outcome: 'invalid', visited_at: now - 2000 });
		await prepareVisitReports(ctx, now);
		const reports = await readPreparedVisitReports(ctx.db, 'go.example.test', '/docs');
		expect(reports?.report.totals).toEqual({ total: 2, valid: 1, invalid: 1, base: 1 });
		expect(reports?.selection.totals.total).toBe(1);
		expect(sum(reports!.report.daily)).toBe(2);
		expect(sum(reports!.report.weekly)).toBe(2);
		expect(sum(reports!.report.monthly)).toBe(2);
		expect(reports?.report.browsers).toEqual([
			{ name: 'Firefox', counts: { total: 2, valid: 1, invalid: 1, base: 1 } }
		]);
		expect(await ctx.db.selectFrom('visits').select('id').execute()).toHaveLength(2);
		await prepareVisitReports(ctx, now);
		expect((await readPreparedVisitReports(ctx.db))?.report.totals.total).toBe(2);
	} finally {
		await ctx.db.destroy();
	}
});

test('zero purges raw history and prepared output without leaving a longer-lived total', async () => {
	const ctx = await context();
	try {
		const now = Date.now();
		await insertVisit(ctx.db, { ...visit, visited_at: now - 1 });
		await prepareVisitReports(ctx, now);
		ctx.config.analytics.retention_months = 0;
		await prepareVisitReports(ctx, now);
		expect(await ctx.db.selectFrom('visits').select('id').execute()).toEqual([]);
		expect(await ctx.db.selectFrom('visit_reports').select('key').execute()).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});

test('clears old output before pruning and publishes nothing if pruning fails', async () => {
	const ctx = await context();
	try {
		const now = Date.parse('2026-05-31T12:00:00Z');
		await insertVisit(ctx.db, { ...visit, visited_at: now - 1 });
		await ctx.db.insertInto('visit_reports').values({ key: 'old-output', data: '{}' }).execute();
		const failure = new Error('Pruning failed');
		vi.mocked(pruneVisits).mockImplementationOnce(async () => {
			expect(await ctx.db.selectFrom('visit_reports').select('key').execute()).toEqual([]);
			throw failure;
		});

		await expect(prepareVisitReports(ctx, now)).rejects.toBe(failure);
		expect(pruneVisits).toHaveBeenCalledExactlyOnceWith(ctx.db, Date.parse('2026-02-28T12:00:00Z'));
		expect(await ctx.db.selectFrom('visit_reports').select('key').execute()).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});

test('stops pruning and does not publish obsolete output when positive retention changes', async () => {
	const ctx = await context();
	try {
		const now = Date.parse('2026-05-31T12:00:00Z');
		await insertVisit(ctx.db, { ...visit, visited_at: now - 1 });
		await ctx.db.insertInto('visit_reports').values({ key: 'old-output', data: '{}' }).execute();
		vi.mocked(pruneVisits).mockImplementationOnce(async () => {
			ctx.config.analytics.retention_months = 9;
			return true;
		});

		await prepareVisitReports(ctx, now);
		expect(pruneVisits).toHaveBeenCalledOnce();
		expect(await ctx.db.selectFrom('visit_reports').select('key').execute()).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});
