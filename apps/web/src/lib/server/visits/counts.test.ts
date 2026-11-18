import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addVisitTotals, insertVisit, openDb, runMigrations } from '@goto/db';
import { expect, test } from 'vitest';
import { readStoredLinkVisitCounts } from './counts.js';

test('recovers prepared totals plus pending valid named visits through the public database reader', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-link-visit-counts-'));
	const path = join(directory, 'goto.sqlite');
	try {
		const writer = await openDb(path);
		try {
			await runMigrations(writer);
			const visit = {
				domain: 'go.example.test',
				path: '/docs',
				outcome: 'valid' as const,
				visited_at: 1_700_000_000_000,
				ip: null,
				user_agent: null,
				accept_language: null,
				browser: 'Other',
				os: 'Other'
			};
			await writer.transaction().execute(async (transaction) => {
				await addVisitTotals(transaction, [
					{
						scope: { kind: 'link', domain: visit.domain, path: visit.path },
						totals: { validVisits: 4, invalidVisits: 0 }
					}
				]);
				const processedId = await insertVisit(transaction, visit);
				await transaction
					.updateTable('visits')
					.set({ processed: 1 })
					.where('id', '=', processedId)
					.execute();
			});
			await insertVisit(writer, visit);
			await insertVisit(writer, visit);
			await insertVisit(writer, { ...visit, outcome: 'invalid' });
		} finally {
			await writer.destroy();
		}
		expect(
			await readStoredLinkVisitCounts(path, [
				{ domain: 'go.example.test', path: '/docs' },
				{ domain: 'go.example.test', path: '/new' }
			])
		).toEqual([
			{ domain: 'go.example.test', path: '/docs', visits: 6 },
			{ domain: 'go.example.test', path: '/new', visits: 0 }
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('failed recovery is unavailable rather than zero and never creates a missing database', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-link-visit-counts-'));
	const path = join(directory, 'missing.sqlite');
	try {
		await expect(
			readStoredLinkVisitCounts(path, [{ domain: 'go.example.test', path: '/docs' }])
		).rejects.toThrow('Link visit counts unavailable');
		expect(existsSync(path)).toBe(false);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
