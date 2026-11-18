import { Piscina } from 'piscina';

export const MAX_OUTSTANDING_VISITS = 1000;

export function startVisitWriterThread(databasePath: string): Piscina {
	return new Piscina({
		filename: import.meta.resolve('@goto/db/visit-worker'),
		name: 'recordVisit',
		workerData: { databasePath },
		minThreads: 1,
		maxThreads: 1,
		concurrentTasksPerWorker: 1,
		stricterFIFO: true,
		maxQueue: MAX_OUTSTANDING_VISITS,
		closeTimeout: 5000
	});
}

export async function stopVisitWriterThread(writerThread: Piscina): Promise<void> {
	const databaseClosed = writerThread.run(null, { name: 'close' });
	const threadClosed = writerThread.close();
	const results = await Promise.allSettled([databaseClosed, threadClosed]);
	const failed = results.some((result) => result.status === 'rejected');
	if (failed) throw new Error('Visit writer thread shutdown failed');
}
