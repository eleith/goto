import type { NewVisit } from '@goto/db';
import {
	MAX_OUTSTANDING_VISITS,
	startVisitWriterThread,
	stopVisitWriterThread
} from './writer-thread.js';

const MAX_VISIT_BYTES = 32 * 1024;
const WARNINGS = {
	queue: 'Visit recording queue full (1000 outstanding); dropping visit',
	size: 'Visit payload exceeds 32 KiB; dropping visit',
	unavailable: 'Visit tracking unavailable; some visits may not be recorded'
};

type WritingWarning = keyof typeof WARNINGS;

export interface VisitWriter {
	waitUntilReady(): Promise<void>;
	queueVisit(visit: NewVisit): void;
	stop(): Promise<void>;
}

export function createVisitWriter(databasePath: string): VisitWriter {
	const reportedWarnings = new Set<WritingWarning>();
	const readiness = Promise.withResolvers<void>();
	let writerThread: ReturnType<typeof startVisitWriterThread> | undefined;
	let writerReady = false;
	let outstandingVisits = 0;
	let stopping: Promise<void> | undefined;

	void readiness.promise.catch(() => {});
	startWriter();

	return { waitUntilReady, queueVisit, stop };

	function waitUntilReady(): Promise<void> {
		return readiness.promise;
	}

	function queueVisit(visit: NewVisit): void {
		if (!writerReady || !writerThread || stopping) return;
		if (dropVisitIfOverLimit(visit)) return;
		sendVisitToWriterThread(writerThread, visit);
	}

	function stop(): Promise<void> {
		if (!stopping) {
			stopping = writerThread
				? stopVisitWriterThread(writerThread).catch(reportUnavailable)
				: Promise.resolve();
		}
		return stopping;
	}

	function dropVisitIfOverLimit(visit: NewVisit): boolean {
		if (outstandingVisits >= MAX_OUTSTANDING_VISITS) {
			reportWarning('queue');
			return true;
		}
		if (exceedsVisitSizeLimit(visit)) {
			reportWarning('size');
			return true;
		}
		return false;
	}

	function sendVisitToWriterThread(
		writerThread: ReturnType<typeof startVisitWriterThread>,
		visit: NewVisit
	): void {
		outstandingVisits += 1;
		try {
			const recorded = writerThread.run(visit);
			void recorded.then(finishVisitWrite, handleVisitWriteFailure);
		} catch {
			handleVisitWriteFailure();
		}
	}

	function startWriter(): void {
		try {
			writerThread = startVisitWriterThread(databasePath);
			writerThread.on('error', handleWriterFailure);
			const initialized = writerThread.run(null, { name: 'ready' });
			void initialized.then(finishWriterStartup, handleWriterFailure);
		} catch {
			handleWriterFailure();
		}
	}

	function finishVisitWrite(): void {
		outstandingVisits -= 1;
	}

	function handleVisitWriteFailure(): void {
		finishVisitWrite();
		reportUnavailable();
	}

	function finishWriterStartup(): void {
		if (stopping) {
			readiness.reject(new Error('Visit recording initialization stopped'));
			return;
		}
		writerReady = true;
		readiness.resolve();
	}

	function handleWriterFailure(): void {
		readiness.reject(new Error('Visit recording initialization failed'));
		reportUnavailable();
		void stop();
	}

	function reportUnavailable(): void {
		reportWarning('unavailable');
	}

	function reportWarning(reason: WritingWarning): void {
		if (reportedWarnings.has(reason)) return;
		reportedWarnings.add(reason);
		try {
			console.warn(WARNINGS[reason]);
		} catch {
			return;
		}
	}
}

function exceedsVisitSizeLimit(visit: NewVisit): boolean {
	const textFields = [
		visit.domain,
		visit.path,
		visit.outcome,
		visit.ip,
		visit.user_agent,
		visit.accept_language
	];
	let bytes = 8;
	for (const value of textFields) {
		bytes += Buffer.byteLength(value ?? '');
		if (bytes > MAX_VISIT_BYTES) return true;
	}
	return false;
}
