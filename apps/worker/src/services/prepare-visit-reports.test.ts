import { encodeVisitReports, type VisitTotals } from '@goto/analytics';
import { validateConfig } from '@goto/config';
import { openDb, runMigrations, insertVisit, pruneVisits, type ClassifiedVisit } from '@goto/db';
import { readVisitSummary, readVisitDetails } from '@goto/db/visit-reports';
import { afterEach, expect, test, vi } from 'vitest';
import { prepareVisitReports } from './prepare-visit-reports.js';
import type { WorkerContext } from './context.js';

vi.mock('@goto/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@goto/db')>();
	return { ...actual, pruneVisits: vi.fn(actual.pruneVisits) };
});

vi.mock('@goto/analytics', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@goto/analytics')>();
	return { ...actual, encodeVisitReports: vi.fn(actual.encodeVisitReports) };
});

afterEach(() => {
	vi.mocked(pruneVisits).mockReset();
	vi.mocked(encodeVisitReports).mockReset();
});

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
const overview = { kind: 'overview' as const };
const domain = { kind: 'domain' as const, domain: 'go.example.test' };
const docs = { kind: 'link' as const, domain: 'go.example.test', path: '/docs' };

function sum(values: VisitTotals[]): VisitTotals {
	return values.reduce(
		(total, value) => ({
			validVisits: total.validVisits + value.validVisits,
			invalidVisits: total.invalidVisits + value.invalidVisits
		}),
		{ validVisits: 0, invalidVisits: 0 }
	);
}

test('publishes summary/detail pairs for all scopes, deletes expired history and is repeatable', async () => {
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
		const summary = await readVisitSummary(ctx.db, domain);
		const details = await readVisitDetails(ctx.db, domain);
		expect(summary?.totals).toEqual({ validVisits: 1, invalidVisits: 1 });
		expect(summary?.scope).toEqual(domain);
		expect(summary?.period.from).toBe('2026-02-28T12:00:00.000Z');
		expect(summary?.period.asOf).toBe('2026-05-31T12:00:00.000Z');
		expect(details?.scope).toEqual(summary?.scope);
		expect(details?.period).toEqual(summary?.period);
		expect((await readVisitSummary(ctx.db, docs))?.totals).toEqual({
			validVisits: 1,
			invalidVisits: 0
		});
		expect(sum(details!.daily)).toEqual(summary?.totals);
		expect(details?.browsers).toEqual([{ family: 'Firefox', validVisits: 1, invalidVisits: 1 }]);
		expect(details?.operatingSystems).toEqual([
			{ family: 'Linux', validVisits: 1, invalidVisits: 1 }
		]);
		expect(await ctx.db.selectFrom('analytics_reports').select('id').execute()).toHaveLength(4);
		expect(await ctx.db.selectFrom('visits').select('id').execute()).toHaveLength(2);
		await prepareVisitReports(ctx, now);
		expect((await readVisitSummary(ctx.db, overview))?.totals).toEqual(summary?.totals);
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
		expect(await ctx.db.selectFrom('analytics_reports').select('id').execute()).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});

test('encodes the whole batch before clearing output or pruning history', async () => {
	const ctx = await context();
	try {
		const now = Date.parse('2026-05-31T12:00:00Z');
		await insertVisit(ctx.db, { ...visit, visited_at: now - 1 });
		await prepareVisitReports(ctx, now);
		const previous = await readVisitSummary(ctx.db, overview);
		vi.mocked(pruneVisits).mockClear();
		const failure = new Error('Invalid report pair');
		vi.mocked(encodeVisitReports).mockClear();
		vi.mocked(encodeVisitReports).mockImplementationOnce(() => {
			throw failure;
		});

		await expect(prepareVisitReports(ctx, now)).rejects.toBe(failure);
		expect(encodeVisitReports).toHaveBeenCalledOnce();
		expect(pruneVisits).not.toHaveBeenCalled();
		expect(await readVisitSummary(ctx.db, overview)).toEqual(previous);
		expect(await ctx.db.selectFrom('visits').select('id').execute()).toHaveLength(1);
	} finally {
		await ctx.db.destroy();
	}
});

test('clears old output before pruning and publishes nothing if pruning fails', async () => {
	const ctx = await context();
	try {
		const now = Date.parse('2026-05-31T12:00:00Z');
		await insertVisit(ctx.db, { ...visit, visited_at: now - 1 });
		await prepareVisitReports(ctx, now);
		vi.mocked(pruneVisits).mockClear();
		const failure = new Error('Pruning failed');
		vi.mocked(pruneVisits).mockImplementationOnce(async () => {
			expect(await ctx.db.selectFrom('analytics_reports').select('id').execute()).toEqual([]);
			throw failure;
		});

		await expect(prepareVisitReports(ctx, now)).rejects.toBe(failure);
		expect(pruneVisits).toHaveBeenCalledExactlyOnceWith(ctx.db, Date.parse('2026-02-28T12:00:00Z'));
		expect(await ctx.db.selectFrom('analytics_reports').select('id').execute()).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});

test('stops pruning and does not publish obsolete output when positive retention changes', async () => {
	const ctx = await context();
	try {
		const now = Date.parse('2026-05-31T12:00:00Z');
		await insertVisit(ctx.db, { ...visit, visited_at: now - 1 });
		await prepareVisitReports(ctx, now);
		vi.mocked(pruneVisits).mockClear();
		vi.mocked(pruneVisits).mockImplementationOnce(async () => {
			ctx.config.analytics.retention_months = 9;
			return true;
		});

		await prepareVisitReports(ctx, now);
		expect(pruneVisits).toHaveBeenCalledOnce();
		expect(await ctx.db.selectFrom('analytics_reports').select('id').execute()).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});
