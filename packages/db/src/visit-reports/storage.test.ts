import { afterEach, beforeEach, expect, test } from 'vitest';
import { openDb, runMigrations } from '../index.js';
import { clearVisitReports, publishVisitReports, readPreparedVisitReports } from './storage.js';
import {
	visitReportKey,
	zeroVisitCounts,
	type PreparedVisitReport,
	type SerializedVisitReport,
	type VisitCounts,
	type VisitReportPeriod
} from './types.js';

let db: Awaited<ReturnType<typeof openDb>>;

const domain = 'go.example.test';
const period: VisitReportPeriod = {
	timezone: 'UTC',
	retentionMonths: 3,
	since: Date.UTC(2026, 0, 1),
	asOf: Date.UTC(2026, 0, 2),
	days: [{ start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 0, 2), partial: false }],
	weeks: [{ start: Date.UTC(2025, 11, 29), end: Date.UTC(2026, 0, 5), partial: true }],
	months: [{ start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 1, 1), partial: true }]
};

beforeEach(async () => {
	db = await openDb(':memory:');
	await runMigrations(db);
});

afterEach(async () => {
	await db.destroy();
});

function preparedReport(counts: VisitCounts = zeroVisitCounts()): PreparedVisitReport {
	return {
		totals: counts,
		daily: [counts],
		weekly: [counts],
		monthly: [counts],
		browsers: [],
		operatingSystems: [],
		domainCounts: [],
		linkCounts: []
	};
}

function serializedReport(key: string, report: PreparedVisitReport): SerializedVisitReport {
	return { key, data: JSON.stringify(report) };
}

test('reads the shared period, scope report and selected path from prepared rows', async () => {
	const selection = preparedReport({ total: 1, valid: 1, invalid: 0, base: 0 });
	selection.browsers = [{ name: 'Firefox', counts: selection.totals }];
	selection.operatingSystems = [{ name: 'Linux', counts: selection.totals }];
	const domainReport = preparedReport({ total: 2, valid: 1, invalid: 1, base: 1 });
	domainReport.linkCounts = [{ path: '/docs', counts: selection.totals }];
	const overview = preparedReport({ total: 3, valid: 2, invalid: 1, base: 1 });
	overview.domainCounts = [{ domain, counts: domainReport.totals }];
	await publishVisitReports(db, period, [
		serializedReport('empty', preparedReport()),
		serializedReport(visitReportKey(), overview),
		serializedReport(visitReportKey(domain), domainReport),
		serializedReport(visitReportKey(domain, '/docs'), selection)
	]);

	expect(await readPreparedVisitReports(db)).toEqual({
		period,
		report: overview,
		selection: overview
	});
	expect(await readPreparedVisitReports(db, domain)).toEqual({
		period,
		report: domainReport,
		selection: domainReport
	});
	expect(await readPreparedVisitReports(db, domain, '/docs')).toEqual({
		period,
		report: domainReport,
		selection
	});
});

test('publication replaces all output rows and a failed replacement preserves the previous set', async () => {
	const oldReport = preparedReport({ total: 1, valid: 1, invalid: 0, base: 0 });
	await publishVisitReports(db, period, [
		serializedReport(visitReportKey(), oldReport),
		serializedReport(visitReportKey(domain), oldReport)
	]);
	const replacementPeriod = { ...period, retentionMonths: 9 as const };
	const replacementReport = preparedReport({ total: 2, valid: 1, invalid: 1, base: 0 });
	const replacementRows = [serializedReport(visitReportKey(), replacementReport)];
	await publishVisitReports(db, replacementPeriod, replacementRows);

	expect(await db.selectFrom('visit_reports').select('key').orderBy('key').execute()).toEqual([
		{ key: 'overview' },
		{ key: 'period' }
	]);
	expect(await readPreparedVisitReports(db, domain)).toBeNull();
	await expect(
		publishVisitReports(db, period, [
			serializedReport(visitReportKey(), oldReport),
			serializedReport(visitReportKey(), oldReport)
		])
	).rejects.toThrow();
	expect(await readPreparedVisitReports(db)).toEqual({
		period: replacementPeriod,
		report: replacementReport,
		selection: replacementReport
	});
});

test('a published zero-count path uses the empty template but a missing domain stays unavailable', async () => {
	const domainReport = preparedReport({ total: 1, valid: 1, invalid: 0, base: 1 });
	domainReport.linkCounts = [{ path: '/new', counts: zeroVisitCounts() }];
	const empty = preparedReport();
	await publishVisitReports(db, period, [
		serializedReport(visitReportKey(domain), domainReport),
		serializedReport('empty', empty)
	]);

	expect(await readPreparedVisitReports(db, domain, '/new')).toEqual({
		period,
		report: domainReport,
		selection: empty
	});
	expect(await readPreparedVisitReports(db, 'new.example.test', '/new')).toBeNull();
});

test('missing link bodies stay unavailable for unpublished paths and populated links', async () => {
	const domainReport = preparedReport({ total: 1, valid: 1, invalid: 0, base: 0 });
	domainReport.linkCounts = [{ path: '/docs', counts: domainReport.totals }];
	await publishVisitReports(db, period, [
		serializedReport(visitReportKey(domain), domainReport),
		serializedReport('empty', preparedReport())
	]);

	expect(await readPreparedVisitReports(db, domain, '/new')).toBeNull();
	expect(await readPreparedVisitReports(db, domain, '/docs')).toBeNull();
});

test('missing metadata is unavailable and clearing deletes every output row', async () => {
	expect(await readPreparedVisitReports(db)).toBeNull();
	await db
		.insertInto('visit_reports')
		.values(serializedReport(visitReportKey(), preparedReport()))
		.execute();
	expect(await readPreparedVisitReports(db)).toBeNull();

	await publishVisitReports(db, period, [
		serializedReport(visitReportKey(), preparedReport()),
		serializedReport('empty', preparedReport())
	]);
	await clearVisitReports(db);
	expect(await db.selectFrom('visit_reports').selectAll().execute()).toEqual([]);
	expect(await readPreparedVisitReports(db)).toBeNull();
});

test('malformed stored JSON is left for the caller to handle', async () => {
	await publishVisitReports(db, period, [{ key: visitReportKey(), data: '{' }]);

	await expect(readPreparedVisitReports(db)).rejects.toThrow(SyntaxError);
});
