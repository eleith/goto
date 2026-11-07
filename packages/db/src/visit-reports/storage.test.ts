import {
	createVisitPeriod,
	encodeVisitReports,
	visitDays,
	zeroVisitTotals,
	type PreparedVisitReport,
	type ReportScope,
	type VisitSummary,
	type VisitTotals
} from '@goto/analytics';
import { DatabaseSync } from 'node:sqlite';
import { sql } from 'kysely';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb, runMigrations } from '../index.js';
import {
	clearVisitReports,
	publishVisitReports,
	readVisitDetails,
	readVisitSummary
} from './storage.js';

let db: Awaited<ReturnType<typeof openDb>>;
const domain = 'go.example.test';
const overviewScope = { kind: 'overview' } as const;
const domainScope = { kind: 'domain', domain } as const;
const rootScope = { kind: 'link', domain, path: '/' } as const;
const asOf = Date.UTC(2026, 3, 1);

beforeEach(async () => {
	db = await openDb(':memory:');
	await runMigrations(db);
});

afterEach(async () => {
	await db.destroy();
});

function preparedReport(
	scope: ReportScope,
	cutoff = asOf,
	totals: VisitTotals = zeroVisitTotals()
): PreparedVisitReport {
	const period = createVisitPeriod(3, cutoff);
	let summary: VisitSummary;
	if (scope.kind === 'overview') {
		summary = { version: 1, scope, period, totals, base: zeroVisitTotals(), domains: [] };
	} else if (scope.kind === 'domain') {
		summary = { version: 1, scope, period, totals, base: zeroVisitTotals(), links: [] };
	} else {
		summary = { version: 1, scope, period, totals };
	}
	const populated = totals.validVisits + totals.invalidVisits > 0;
	return {
		summary,
		details: {
			version: 1,
			scope,
			period,
			daily: visitDays(period).map((day, index) => ({
				...day,
				...(index === 0 ? totals : zeroVisitTotals())
			})),
			browsers: populated ? [{ family: 'Firefox', ...totals }] : [],
			operatingSystems: populated ? [{ family: 'Linux', ...totals }] : []
		}
	};
}

test('reads summary and details for each explicit SQL scope including root', async () => {
	const reports = [
		preparedReport(overviewScope, asOf, { validVisits: 2, invalidVisits: 1 }),
		preparedReport(domainScope, asOf, { validVisits: 1, invalidVisits: 1 }),
		preparedReport(rootScope)
	];
	await publishVisitReports(db, encodeVisitReports(reports));

	for (const report of reports) {
		expect(await readVisitSummary(db, report.summary.scope)).toEqual(report.summary);
		expect(await readVisitDetails(db, report.summary.scope)).toEqual(report.details);
	}
	expect(
		await db
			.selectFrom('analytics_reports')
			.select(['scope_kind', 'domain', 'path'])
			.orderBy('id')
			.execute()
	).toEqual([
		{ scope_kind: 'overview', domain: null, path: null },
		{ scope_kind: 'domain', domain, path: null },
		{ scope_kind: 'link', domain, path: '/' }
	]);
});

test('publication replaces the complete batch, including when the replacement is empty', async () => {
	await publishVisitReports(
		db,
		encodeVisitReports([preparedReport(overviewScope), preparedReport(domainScope)])
	);
	const replacement = preparedReport(overviewScope, asOf + 86_400_000);
	await publishVisitReports(db, encodeVisitReports([replacement]));

	expect(await readVisitSummary(db, overviewScope)).toEqual(replacement.summary);
	expect(await readVisitSummary(db, domainScope)).toBeNull();
	await publishVisitReports(db, []);
	expect(await db.selectFrom('analytics_reports').select('id').execute()).toEqual([]);
});

test('native uniqueness and JSON failures roll back publication deletion', async () => {
	const original = preparedReport(overviewScope);
	await publishVisitReports(db, encodeVisitReports([original]));
	const [replacement] = encodeVisitReports([preparedReport(domainScope)]);
	if (!replacement) throw new Error('Expected an encoded report fixture');

	for (const batch of [
		[replacement, replacement],
		[{ ...replacement, summaryJson: '{' }],
		[{ ...replacement, detailsJson: '{' }]
	]) {
		await expect(publishVisitReports(db, batch)).rejects.toThrow();
		expect(await readVisitSummary(db, overviewScope)).toEqual(original.summary);
		expect(await readVisitDetails(db, overviewScope)).toEqual(original.details);
		expect(await readVisitSummary(db, domainScope)).toBeNull();
	}
});

test('missing scopes are null, not implicit empty reports or parent fallbacks', async () => {
	const report = preparedReport(domainScope);
	if (!('links' in report.summary)) throw new Error('Expected a domain fixture');
	report.summary.links = [{ path: '/new', totals: zeroVisitTotals() }];
	await publishVisitReports(db, encodeVisitReports([report]));

	expect(await readVisitSummary(db, overviewScope)).toBeNull();
	expect(await readVisitSummary(db, { kind: 'link', domain, path: '/new' })).toBeNull();
	expect(await readVisitDetails(db, rootScope)).toBeNull();
	await clearVisitReports(db);
	expect(await readVisitSummary(db, domainScope)).toBeNull();
	expect(await db.selectFrom('analytics_reports').select('id').execute()).toEqual([]);
});

test('summary and details readers select and decode only their own column', async () => {
	const report = preparedReport(overviewScope);
	const rows = encodeVisitReports([report]);
	const [row] = rows;
	if (!row) throw new Error('Expected an encoded report fixture');
	await publishVisitReports(db, rows);
	await db.updateTable('analytics_reports').set({ details_json: '{}' }).execute();

	const statements = vi.spyOn(DatabaseSync.prototype, 'prepare');
	try {
		expect(await readVisitSummary(db, overviewScope)).toEqual(report.summary);
		expect(statements.mock.calls.map(([query]) => query)).toEqual([
			expect.stringMatching(/^select\s+"summary_json"\s+from\s+/i)
		]);
		statements.mockClear();
		await expect(readVisitDetails(db, overviewScope)).rejects.toThrow('Invalid analytics report');
		expect(statements.mock.calls.map(([query]) => query)).toEqual([
			expect.stringMatching(/^select\s+"details_json"\s+from\s+/i)
		]);
	} finally {
		statements.mockRestore();
	}
	await db
		.updateTable('analytics_reports')
		.set({ summary_json: '{}', details_json: row.detailsJson })
		.execute();
	expect(await readVisitDetails(db, overviewScope)).toEqual(report.details);
	await expect(readVisitSummary(db, overviewScope)).rejects.toThrow('Invalid analytics report');
});

test('database constraints reject invalid scope shapes, duplicate identities and malformed JSON', async () => {
	const reports = encodeVisitReports(
		[overviewScope, domainScope, rootScope].map((scope) => preparedReport(scope))
	);
	await publishVisitReports(db, reports);

	for (const report of reports) {
		const scope = report.scope;
		await expect(
			db
				.insertInto('analytics_reports')
				.values({
					scope_kind: scope.kind,
					domain: scope.kind === 'overview' ? null : scope.domain,
					path: scope.kind === 'link' ? scope.path : null,
					summary_json: report.summaryJson,
					details_json: report.detailsJson
				})
				.execute()
		).rejects.toThrow();
	}
	await expect(
		sql`INSERT INTO analytics_reports (scope_kind, domain, path, summary_json, details_json)
		VALUES ('overview', 'bad.example.test', NULL, '{}', '{}')`.execute(db)
	).rejects.toThrow();
	await expect(
		sql`INSERT INTO analytics_reports (scope_kind, domain, path, summary_json, details_json)
		VALUES ('domain', NULL, NULL, '{}', '{}')`.execute(db)
	).rejects.toThrow();
	await expect(
		sql`INSERT INTO analytics_reports (scope_kind, domain, path, summary_json, details_json)
		VALUES ('link', 'go.example.test', NULL, '{}', '{}')`.execute(db)
	).rejects.toThrow();
	await expect(
		sql`INSERT INTO analytics_reports (scope_kind, domain, path, summary_json, details_json)
		VALUES ('unknown', NULL, NULL, '{}', '{}')`.execute(db)
	).rejects.toThrow();
	await expect(
		sql`INSERT INTO analytics_reports (scope_kind, domain, path, summary_json, details_json)
		VALUES ('domain', '', NULL, '{}', '{}')`.execute(db)
	).rejects.toThrow();
	await expect(
		sql`INSERT INTO analytics_reports (scope_kind, domain, path, summary_json, details_json)
		VALUES ('link', '', '/docs', '{}', '{}')`.execute(db)
	).rejects.toThrow();
	await expect(
		sql`INSERT INTO analytics_reports (scope_kind, domain, path, summary_json, details_json)
		VALUES ('link', 'go.example.test', '', '{}', '{}')`.execute(db)
	).rejects.toThrow();
	await expect(
		sql`INSERT INTO analytics_reports (scope_kind, domain, path, summary_json, details_json)
		VALUES ('link', 'go.example.test', 'docs', '{}', '{}')`.execute(db)
	).rejects.toThrow();
	await expect(
		db.updateTable('analytics_reports').set({ summary_json: '{' }).execute()
	).rejects.toThrow();
	await expect(
		db.updateTable('analytics_reports').set({ details_json: '{' }).execute()
	).rejects.toThrow();
});
