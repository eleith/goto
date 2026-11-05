import { Piscina } from 'piscina';

export const MAX_OUTSTANDING = 1000;

export function createVisitPool(databasePath: string): Piscina {
	return new Piscina({
		filename: import.meta.resolve('@goto/db/visit-worker'),
		name: 'recordVisit',
		workerData: { databasePath },
		minThreads: 1,
		maxThreads: 1,
		concurrentTasksPerWorker: 1,
		stricterFIFO: true,
		maxQueue: MAX_OUTSTANDING,
		closeTimeout: 5000
	});
}

export async function closeVisitPool(pool: Piscina): Promise<void> {
	const databaseClosed = pool.run(null, { name: 'close' });
	const poolClosed = pool.close();
	const results = await Promise.allSettled([databaseClosed, poolClosed]);
	const failed = results.some((result) => result.status === 'rejected');
	if (failed) throw new Error('Visit pool shutdown failed');
}
