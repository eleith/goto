import { openDb, readLinkVisitCounts } from '@goto/db';

export async function readStoredLinkVisitCounts(
	databasePath: string,
	links: readonly { domain: string; path: string }[]
): Promise<Array<{ domain: string; path: string; visits: number }>> {
	try {
		const db = await openDb(databasePath, { readOnly: true });
		try {
			return await readLinkVisitCounts(db, links);
		} finally {
			await db.destroy();
		}
	} catch {
		throw new Error('Link visit counts unavailable');
	}
}
