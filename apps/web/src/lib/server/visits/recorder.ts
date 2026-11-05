import type { Piscina } from 'piscina';
import type { NewVisit } from '@goto/db';
import { closeVisitPool, createVisitPool, MAX_OUTSTANDING } from './pool.js';

const MAX_VISIT_BYTES = 32 * 1024;
const WARNINGS = {
	queue: 'Visit recording queue full (1000 outstanding); dropping analytics visit',
	size: 'Visit payload exceeds 32 KiB; dropping analytics visit',
	unavailable: 'Visit tracking unavailable; some visits may not be recorded'
};

type RecordingWarning = keyof typeof WARNINGS;

export interface VisitRecorder {
	recordVisit(visit: NewVisit): void;
	stop(): Promise<void>;
}

export function createVisitRecorder(databasePath: string): VisitRecorder {
	return new Recorder(databasePath);
}

function exceedsVisitSizeLimit(visit: NewVisit): boolean {
	const textFields = [visit.domain, visit.path, visit.ip, visit.user_agent, visit.accept_language];
	let bytes = 8;
	for (const value of textFields) {
		bytes += Buffer.byteLength(value ?? '');
		if (bytes > MAX_VISIT_BYTES) return true;
	}
	return false;
}

class Recorder implements VisitRecorder {
	private readonly reported = new Set<RecordingWarning>();
	private pool: Piscina | undefined;
	private ready = false;
	private outstanding = 0;
	private stopping: Promise<void> | undefined;

	constructor(databasePath: string) {
		this.startPool(databasePath);
	}

	readonly recordVisit = (visit: NewVisit): void => {
		const pool = this.pool;
		if (!this.ready || !pool || this.stopping) return;
		if (this.dropVisitIfOverLimit(visit)) return;
		this.submitVisit(pool, visit);
	};

	readonly stop = (): Promise<void> => {
		if (!this.stopping) {
			this.stopping = this.pool
				? closeVisitPool(this.pool).catch(this.reportUnavailable)
				: Promise.resolve();
		}
		return this.stopping;
	};

	private dropVisitIfOverLimit(visit: NewVisit): boolean {
		if (this.outstanding >= MAX_OUTSTANDING) {
			this.report('queue');
			return true;
		}
		if (exceedsVisitSizeLimit(visit)) {
			this.report('size');
			return true;
		}
		return false;
	}

	private submitVisit(pool: Piscina, visit: NewVisit): void {
		this.outstanding += 1;
		try {
			const recorded = pool.run(visit);
			void recorded.then(this.onRecorded, this.onRecordFailure);
		} catch {
			this.onRecordFailure();
		}
	}

	private startPool(databasePath: string): void {
		try {
			const pool = createVisitPool(databasePath);
			this.pool = pool;
			pool.on('error', this.onPoolFailure);
			const initialized = pool.run(null, { name: 'ready' });
			void initialized.then(this.onReady, this.onPoolFailure);
		} catch {
			this.onPoolFailure();
		}
	}

	private readonly onRecorded = (): void => {
		this.outstanding -= 1;
	};

	private readonly onRecordFailure = (): void => {
		this.onRecorded();
		this.reportUnavailable();
	};

	private readonly onReady = (): void => {
		if (!this.stopping) this.ready = true;
	};

	private readonly onPoolFailure = (): void => {
		this.reportUnavailable();
		void this.stop();
	};

	private readonly reportUnavailable = (): void => {
		this.report('unavailable');
	};

	private report(reason: RecordingWarning): void {
		if (this.reported.has(reason)) return;
		this.reported.add(reason);
		try {
			console.warn(WARNINGS[reason]);
		} catch {
			return;
		}
	}
}
