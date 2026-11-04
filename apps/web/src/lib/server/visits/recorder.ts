import { Piscina } from 'piscina';
import type { NewVisit } from '@goto/db';

const MAX_OUTSTANDING = 256;
const MAX_VISIT_BYTES = 32 * 1024;
const DRAIN_TIMEOUT = 5000;

export interface VisitRecorder {
	recordVisit(visit: NewVisit): void;
	stop(): Promise<void>;
}

function visitBytes(visit: NewVisit): number {
	return [visit.domain, visit.path, visit.ip, visit.user_agent, visit.accept_language].reduce(
		(bytes, value) => bytes + Buffer.byteLength(value ?? ''),
		8
	);
}

export function createVisitRecorder(databasePath: string): VisitRecorder {
	let reported = false;
	function report(): void {
		if (reported) return;
		reported = true;
		try {
			console.warn('Visit tracking unavailable; some visits may not be recorded');
		} catch {
			return;
		}
	}

	let pool: Piscina;
	try {
		pool = new Piscina({
			filename: import.meta.resolve('@goto/db/visit-worker'),
			name: 'recordVisit',
			workerData: { databasePath },
			minThreads: 1,
			maxThreads: 1,
			concurrentTasksPerWorker: 1,
			stricterFIFO: true,
			maxQueue: MAX_OUTSTANDING,
			closeTimeout: DRAIN_TIMEOUT
		});
	} catch {
		report();
		return { recordVisit() {}, async stop() {} };
	}

	let accepting = false;
	let outstanding = 0;
	let stopping: Promise<void> | undefined;

	function stop(): Promise<void> {
		if (stopping) return stopping;
		accepting = false;
		const closed = pool.run(null, { name: 'close' });
		stopping = Promise.allSettled([closed, pool.close()]).then((results) => {
			if (results.some((result) => result.status === 'rejected')) report();
		});
		return stopping;
	}

	pool.on('error', () => {
		report();
		void stop();
	});
	void pool.run(null, { name: 'ready' }).then(
		() => {
			if (!stopping) accepting = true;
		},
		() => {
			report();
			void stop();
		}
	);

	function recordVisit(visit: NewVisit): void {
		if (!accepting) return;
		if (outstanding >= MAX_OUTSTANDING || visitBytes(visit) > MAX_VISIT_BYTES) {
			report();
			return;
		}
		outstanding += 1;
		try {
			void pool.run(visit).then(
				() => {
					outstanding -= 1;
				},
				() => {
					outstanding -= 1;
					report();
				}
			);
		} catch {
			outstanding -= 1;
			report();
		}
	}

	return { recordVisit, stop };
}
