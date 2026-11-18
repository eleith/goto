import type { Kysely } from 'kysely';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
	addVisitTotals,
	openDb,
	readVisitTotals,
	readLinkVisitCounts,
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
	expect(await readVisitTotals(db, overview)).toEqual({ validVisits: 0, invalidVisits: 0 });
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
	expect(await readVisitTotals(db, overview)).toEqual({ validVisits: 4, invalidVisits: 2 });
	expect(await readVisitTotals(db, domain)).toEqual({ validVisits: 4, invalidVisits: 2 });
	expect(await readVisitTotals(db, link)).toEqual({ validVisits: 4, invalidVisits: 0 });
	expect(await readVisitTotals(db, { ...link, path: '/' })).toEqual({
		validVisits: 0,
		invalidVisits: 0
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
	expect(await readVisitTotals(db, overview)).toEqual({ validVisits: 0, invalidVisits: 0 });
	expect(await readVisitTotals(db, link)).toEqual({
		validVisits: Number.MAX_SAFE_INTEGER,
		invalidVisits: 0
	});
});

test('missing storage is a read failure, not a fabricated zero', async () => {
	await db.schema.dropTable('visit_totals').execute();
	await expect(readVisitTotals(db, link)).rejects.toThrow();
	await expect(readLinkVisitCounts(db, [link])).rejects.toThrow();
});
