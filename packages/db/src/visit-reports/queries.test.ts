import { afterEach, beforeEach, expect, test } from 'vitest';
import { openDb, runMigrations, type ClassifiedVisit } from '../index.js';
import { aggregateVisitReports } from './queries.js';
import type { ReportInventory } from './types.js';

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

test('aggregates explicit UTC scope identities, outcomes and root subsets', async () => {
	await seedVisits();
	const result = await aggregateVisitReports(db, since, asOf, inventory);

	expect(result.daily).toHaveLength(8);
	expect(result.daily).toEqual(
		expect.arrayContaining([
			{
				scopeKind: 'overview',
				domain: null,
				path: null,
				day: '2026-01-31',
				validVisits: 1,
				invalidVisits: 0,
				baseValidVisits: 0,
				baseInvalidVisits: 0
			},
			{
				scopeKind: 'overview',
				domain: null,
				path: null,
				day: '2026-02-01',
				validVisits: 1,
				invalidVisits: 4,
				baseValidVisits: 1,
				baseInvalidVisits: 2
			},
			{
				scopeKind: 'domain',
				domain,
				path: null,
				day: '2026-01-31',
				validVisits: 1,
				invalidVisits: 0,
				baseValidVisits: 0,
				baseInvalidVisits: 0
			},
			{
				scopeKind: 'domain',
				domain,
				path: null,
				day: '2026-02-01',
				validVisits: 1,
				invalidVisits: 2,
				baseValidVisits: 1,
				baseInvalidVisits: 1
			},
			{
				scopeKind: 'link',
				domain,
				path: '/docs',
				day: '2026-01-31',
				validVisits: 1,
				invalidVisits: 0,
				baseValidVisits: 0,
				baseInvalidVisits: 0
			},
			{
				scopeKind: 'link',
				domain,
				path: '/',
				day: '2026-02-01',
				validVisits: 1,
				invalidVisits: 1,
				baseValidVisits: 1,
				baseInvalidVisits: 1
			},
			{
				scopeKind: 'domain',
				domain: otherDomain,
				path: null,
				day: '2026-02-01',
				validVisits: 0,
				invalidVisits: 1,
				baseValidVisits: 0,
				baseInvalidVisits: 0
			},
			{
				scopeKind: 'link',
				domain: otherDomain,
				path: '/docs',
				day: '2026-02-01',
				validVisits: 0,
				invalidVisits: 1,
				baseValidVisits: 0,
				baseInvalidVisits: 0
			}
		])
	);
	expect(result.browsers.filter(({ scopeKind }) => scopeKind === 'overview')).toEqual([
		{
			scopeKind: 'overview',
			domain: null,
			path: null,
			day: '2026-01-31',
			name: 'Firefox',
			validVisits: 1,
			invalidVisits: 0
		},
		{
			scopeKind: 'overview',
			domain: null,
			path: null,
			day: '2026-02-01',
			name: 'Firefox',
			validVisits: 0,
			invalidVisits: 3
		},
		{
			scopeKind: 'overview',
			domain: null,
			path: null,
			day: '2026-02-01',
			name: 'Other',
			validVisits: 0,
			invalidVisits: 1
		},
		{
			scopeKind: 'overview',
			domain: null,
			path: null,
			day: '2026-02-01',
			name: 'Safari',
			validVisits: 1,
			invalidVisits: 0
		}
	]);
	expect(result.operatingSystems.filter(({ scopeKind }) => scopeKind === 'overview')).toEqual([
		{
			scopeKind: 'overview',
			domain: null,
			path: null,
			day: '2026-01-31',
			name: 'Linux',
			validVisits: 1,
			invalidVisits: 0
		},
		{
			scopeKind: 'overview',
			domain: null,
			path: null,
			day: '2026-02-01',
			name: 'Linux',
			validVisits: 0,
			invalidVisits: 2
		},
		{
			scopeKind: 'overview',
			domain: null,
			path: null,
			day: '2026-02-01',
			name: 'Other',
			validVisits: 0,
			invalidVisits: 1
		},
		{
			scopeKind: 'overview',
			domain: null,
			path: null,
			day: '2026-02-01',
			name: 'Windows',
			validVisits: 0,
			invalidVisits: 1
		},
		{
			scopeKind: 'overview',
			domain: null,
			path: null,
			day: '2026-02-01',
			name: 'macOS',
			validVisits: 1,
			invalidVisits: 0
		}
	]);
	expect(
		result.browsers.filter(({ scopeKind, path }) => scopeKind === 'link' && path === '/')
	).toEqual([
		{
			scopeKind: 'link',
			domain,
			path: '/',
			day: '2026-02-01',
			name: 'Firefox',
			validVisits: 0,
			invalidVisits: 1
		},
		{
			scopeKind: 'link',
			domain,
			path: '/',
			day: '2026-02-01',
			name: 'Safari',
			validVisits: 1,
			invalidVisits: 0
		}
	]);
	expect(
		result.operatingSystems.filter(
			({ scopeKind, domain: rowDomain }) => scopeKind === 'link' && rowDomain === otherDomain
		)
	).toEqual([
		{
			scopeKind: 'link',
			domain: otherDomain,
			path: '/docs',
			day: '2026-02-01',
			name: 'Windows',
			validVisits: 0,
			invalidVisits: 1
		}
	]);
});

test('empty inventory keeps historical overview traffic but no domain or link scopes', async () => {
	await seedVisits();
	const result = await aggregateVisitReports(db, since, asOf, []);

	expect(result.daily).toEqual([
		{
			scopeKind: 'overview',
			domain: null,
			path: null,
			day: '2026-01-31',
			validVisits: 1,
			invalidVisits: 0,
			baseValidVisits: 0,
			baseInvalidVisits: 0
		},
		{
			scopeKind: 'overview',
			domain: null,
			path: null,
			day: '2026-02-01',
			validVisits: 1,
			invalidVisits: 4,
			baseValidVisits: 1,
			baseInvalidVisits: 2
		}
	]);
	expect(
		[...result.browsers, ...result.operatingSystems].every(
			(row) => row.scopeKind === 'overview' && row.domain === null && row.path === null
		)
	).toBe(true);
});

test('paths remain exact bound identities, including punctuation and Unicode', async () => {
	const path = '/café,"docs';
	await db
		.insertInto('visits')
		.values({ ...visit, path })
		.execute();
	const result = await aggregateVisitReports(db, since, asOf, [{ domain, paths: [path] }]);

	expect(result.daily.find((row) => row.scopeKind === 'link')).toEqual({
		scopeKind: 'link',
		domain,
		path,
		day: '2026-01-31',
		validVisits: 1,
		invalidVisits: 0,
		baseValidVisits: 0,
		baseInvalidVisits: 0
	});
});

test('no visits produces no aggregate rows for configured scopes', async () => {
	expect(await aggregateVisitReports(db, since, asOf, inventory)).toEqual({
		daily: [],
		browsers: [],
		operatingSystems: []
	});
});
