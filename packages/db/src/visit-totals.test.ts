import type { Kysely } from 'kysely';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
	addVisitTotals,
	openDb,
	readDomainLifetimeVisitTotals,
	readOverviewLifetimeVisitTotals,
	readLifetimeVisitTotals,
	readLinkVisitCountsIncludingPending,
	runMigrations,
	type Database
} from './index.js';

let db: Kysely<Database>;
const overview = { kind: 'overview' as const };
const domain = { kind: 'domain' as const, domain: 'go.example.test' };
const link = { kind: 'link' as const, domain: domain.domain, path: '/docs' };

beforeEach(async () => {
	db = await openDb(':memory:');
	await runMigrations(db);
});

afterEach(async () => db.destroy());

test('adds numeric totals per scope inside a caller transaction and reads missing scopes as zero', async () => {
	expect(await readLifetimeVisitTotals(db, overview)).toEqual({ validVisits: 0, invalidVisits: 0 });
	const additions = [
		{ scope: overview, totals: { validVisits: 2, invalidVisits: 1 } },
		{ scope: domain, totals: { validVisits: 2, invalidVisits: 1 } },
		{ scope: link, totals: { validVisits: 2, invalidVisits: 0 } }
	];
	await expect(addVisitTotals(db, additions)).rejects.toThrow('writer transaction');
	await db.transaction().execute(async (transaction) => {
		await addVisitTotals(transaction, additions);
		await addVisitTotals(transaction, additions);
	});
	expect(await readLifetimeVisitTotals(db, overview)).toEqual({ validVisits: 4, invalidVisits: 2 });
	expect(await readLifetimeVisitTotals(db, domain)).toEqual({ validVisits: 4, invalidVisits: 2 });
	expect(await readLifetimeVisitTotals(db, link)).toEqual({ validVisits: 4, invalidVisits: 0 });
	expect(await readLifetimeVisitTotals(db, { ...link, path: '/' })).toEqual({
		validVisits: 0,
		invalidVisits: 0
	});
});

test('separates lifetime Root visits, including former domains in the overview', async () => {
	const formerDomain = { kind: 'domain' as const, domain: 'old.example.test' };
	await db.transaction().execute((transaction) =>
		addVisitTotals(transaction, [
			{ scope: overview, totals: { validVisits: 6, invalidVisits: 2 } },
			{ scope: domain, totals: { validVisits: 4, invalidVisits: 1 } },
			{ scope: formerDomain, totals: { validVisits: 2, invalidVisits: 1 } },
			{ scope: { ...link, path: '/' }, totals: { validVisits: 1, invalidVisits: 0 } },
			{
				scope: { ...link, domain: formerDomain.domain, path: '/' },
				totals: { validVisits: 2, invalidVisits: 0 }
			},
			{ scope: link, totals: { validVisits: 1, invalidVisits: 0 } }
		])
	);

	expect(await readOverviewLifetimeVisitTotals(db, [domain.domain, 'empty.example.test'])).toEqual({
		overview: { validVisits: 3, invalidVisits: 2, rootVisits: 3 },
		byDomain: new Map([
			[domain.domain, { validVisits: 3, invalidVisits: 1 }],
			['empty.example.test', { validVisits: 0, invalidVisits: 0 }]
		])
	});
});

test('reads stored domain, Root, and current path totals without including other domains or paths', async () => {
	await db.transaction().execute((transaction) =>
		addVisitTotals(transaction, [
			{ scope: domain, totals: { validVisits: 9, invalidVisits: 2 } },
			{ scope: { ...link, path: '/' }, totals: { validVisits: 2, invalidVisits: 0 } },
			{ scope: link, totals: { validVisits: 3, invalidVisits: 0 } },
			{ scope: { ...link, path: '/retired' }, totals: { validVisits: 4, invalidVisits: 0 } },
			{
				scope: { ...link, domain: 'other.example.test' },
				totals: { validVisits: 5, invalidVisits: 0 }
			}
		])
	);

	expect(await readDomainLifetimeVisitTotals(db, domain.domain, ['/docs', '/new'])).toEqual({
		domain: { validVisits: 7, invalidVisits: 2, rootVisits: 2 },
		byPath: new Map([
			['/', { validVisits: 2, invalidVisits: 0 }],
			['/docs', { validVisits: 3, invalidVisits: 0 }],
			['/new', { validVisits: 0, invalidVisits: 0 }]
		])
	});
});

test('unsafe accumulated totals roll back the whole addition transaction', async () => {
	await db
		.transaction()
		.execute((transaction) =>
			addVisitTotals(transaction, [
				{ scope: link, totals: { validVisits: Number.MAX_SAFE_INTEGER, invalidVisits: 0 } }
			])
		);
	await expect(
		db.transaction().execute((transaction) =>
			addVisitTotals(transaction, [
				{ scope: overview, totals: { validVisits: 1, invalidVisits: 0 } },
				{ scope: link, totals: { validVisits: 1, invalidVisits: 0 } }
			])
		)
	).rejects.toThrow();
	expect(await readLifetimeVisitTotals(db, overview)).toEqual({ validVisits: 0, invalidVisits: 0 });
	expect(await readLifetimeVisitTotals(db, link)).toEqual({
		validVisits: Number.MAX_SAFE_INTEGER,
		invalidVisits: 0
	});
});

test('missing storage is a read failure, not a fabricated zero', async () => {
	await db.schema.dropTable('visit_totals').execute();
	await expect(readLifetimeVisitTotals(db, link)).rejects.toThrow();
	await expect(readLinkVisitCountsIncludingPending(db, [link])).rejects.toThrow();
});
