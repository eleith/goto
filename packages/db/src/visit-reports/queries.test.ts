import { afterEach, beforeEach, expect, test } from 'vitest';
import { openDb, runMigrations, type ClassifiedVisit } from '../index.js';
import { aggregateVisitReports } from './queries.js';
import { visitReportKey, type ReportInventory } from './types.js';

let db: Awaited<ReturnType<typeof openDb>>;

const domain = 'go.example.test';
const otherDomain = 'other.example.test';
const since = Date.UTC(2026, 0, 31, 23, 59, 59, 999);
const nextDay = Date.UTC(2026, 1, 1);
const asOf = Date.UTC(2026, 1, 2);
const visit: ClassifiedVisit = {
	domain,
	path: '/docs',
	outcome: 'valid',
	visited_at: since,
	ip: '127.0.0.1',
	user_agent: null,
	accept_language: null,
	browser: 'Firefox',
	os: 'Linux'
};
const inventory: ReportInventory = [
	{ domain, paths: ['/docs', '/new', '/docs'] },
	{ domain: otherDomain, paths: ['/docs'] },
	{ domain: 'empty.example.test', paths: [] }
];

beforeEach(async () => {
	db = await openDb(':memory:');
	await runMigrations(db);
});

afterEach(async () => {
	await db.destroy();
});

async function seedVisits(): Promise<void> {
	await db
		.insertInto('visits')
		.values([
			visit,
			{ ...visit, path: '/', visited_at: nextDay, browser: 'Safari', os: 'macOS' },
			{ ...visit, path: '/', outcome: 'invalid', visited_at: nextDay + 1 },
			{
				...visit,
				path: '/unconfigured',
				outcome: 'invalid',
				visited_at: nextDay + 2,
				browser: 'Other',
				os: 'Other'
			},
			{
				...visit,
				domain: 'removed.example.test',
				path: '/',
				outcome: 'invalid',
				visited_at: nextDay + 3
			},
			{
				...visit,
				domain: otherDomain,
				outcome: 'invalid',
				visited_at: nextDay + 4,
				os: 'Windows'
			},
			{ ...visit, visited_at: since - 1 },
			{ ...visit, visited_at: asOf }
		])
		.execute();
}

test('aggregates UTC days and stored families for overview, current domains and known paths', async () => {
	await seedVisits();
	const result = await aggregateVisitReports(db, since, asOf, inventory);
	const overview = visitReportKey();
	const domainScope = visitReportKey(domain);
	const docs = visitReportKey(domain, '/docs');
	const root = visitReportKey(domain, '/');
	const otherDomainScope = visitReportKey(otherDomain);
	const otherDocs = visitReportKey(otherDomain, '/docs');

	expect(result.daily).toHaveLength(8);
	expect(result.daily).toEqual(
		expect.arrayContaining([
			{ scope: overview, day: '2026-01-31', total: 1, valid: 1, invalid: 0, base: 0 },
			{ scope: overview, day: '2026-02-01', total: 5, valid: 1, invalid: 4, base: 3 },
			{ scope: domainScope, day: '2026-01-31', total: 1, valid: 1, invalid: 0, base: 0 },
			{ scope: domainScope, day: '2026-02-01', total: 3, valid: 1, invalid: 2, base: 2 },
			{ scope: docs, day: '2026-01-31', total: 1, valid: 1, invalid: 0, base: 0 },
			{ scope: root, day: '2026-02-01', total: 2, valid: 1, invalid: 1, base: 2 },
			{ scope: otherDomainScope, day: '2026-02-01', total: 1, valid: 0, invalid: 1, base: 0 },
			{ scope: otherDocs, day: '2026-02-01', total: 1, valid: 0, invalid: 1, base: 0 }
		])
	);
	expect(result.browsers.filter(({ scope }) => scope === overview)).toEqual([
		{ scope: overview, name: 'Firefox', total: 4, valid: 1, invalid: 3, base: 2 },
		{ scope: overview, name: 'Other', total: 1, valid: 0, invalid: 1, base: 0 },
		{ scope: overview, name: 'Safari', total: 1, valid: 1, invalid: 0, base: 1 }
	]);
	expect(result.operatingSystems.filter(({ scope }) => scope === overview)).toEqual([
		{ scope: overview, name: 'Linux', total: 3, valid: 1, invalid: 2, base: 2 },
		{ scope: overview, name: 'Other', total: 1, valid: 0, invalid: 1, base: 0 },
		{ scope: overview, name: 'Windows', total: 1, valid: 0, invalid: 1, base: 0 },
		{ scope: overview, name: 'macOS', total: 1, valid: 1, invalid: 0, base: 1 }
	]);
	expect(result.browsers.filter(({ scope }) => scope === domainScope)).toEqual([
		{ scope: domainScope, name: 'Firefox', total: 2, valid: 1, invalid: 1, base: 1 },
		{ scope: domainScope, name: 'Other', total: 1, valid: 0, invalid: 1, base: 0 },
		{ scope: domainScope, name: 'Safari', total: 1, valid: 1, invalid: 0, base: 1 }
	]);
	expect(result.browsers.filter(({ scope }) => scope === root)).toEqual([
		{ scope: root, name: 'Firefox', total: 1, valid: 0, invalid: 1, base: 1 },
		{ scope: root, name: 'Safari', total: 1, valid: 1, invalid: 0, base: 1 }
	]);
	expect(result.operatingSystems.filter(({ scope }) => scope === otherDocs)).toEqual([
		{ scope: otherDocs, name: 'Windows', total: 1, valid: 0, invalid: 1, base: 0 }
	]);
	const familyScopes = new Set(
		[...result.browsers, ...result.operatingSystems].map(({ scope }) => scope)
	);
	expect(familyScopes).toEqual(
		new Set([overview, domainScope, docs, root, otherDomainScope, otherDocs])
	);
});

test('empty inventory still aggregates historical visits only under overview', async () => {
	await seedVisits();
	const result = await aggregateVisitReports(db, since, asOf, []);

	expect(result.daily).toEqual([
		{ scope: 'overview', day: '2026-01-31', total: 1, valid: 1, invalid: 0, base: 0 },
		{ scope: 'overview', day: '2026-02-01', total: 5, valid: 1, invalid: 4, base: 3 }
	]);
	expect(result.browsers.map(({ scope }) => scope)).toEqual(['overview', 'overview', 'overview']);
	expect(result.operatingSystems.map(({ scope }) => scope)).toEqual([
		'overview',
		'overview',
		'overview',
		'overview'
	]);
});

test('no visits produces no aggregate rows for configured scopes', async () => {
	expect(await aggregateVisitReports(db, since, asOf, inventory)).toEqual({
		daily: [],
		browsers: [],
		operatingSystems: []
	});
});
