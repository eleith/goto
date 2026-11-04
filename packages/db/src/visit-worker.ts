import { workerData } from 'node:worker_threads';
import { openDb, runMigrations, insertVisit, type NewVisit } from './index.js';

const { databasePath } = workerData as { databasePath: string };
const db = await openDb(databasePath);
try {
	await runMigrations(db);
} catch (error) {
	await db.destroy();
	throw error;
}

export function ready(): void {}

export async function recordVisit(visit: NewVisit): Promise<void> {
	await insertVisit(db, visit);
}

export async function close(): Promise<void> {
	await db.destroy();
}
