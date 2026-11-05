import type { Piscina } from 'piscina';
import type { NewVisit } from '@goto/db';
import { closeVisitPool, createVisitPool, MAX_OUTSTANDING } from './pool.js';

const MAX_VISIT_BYTES = 32 * 1024;

export interface VisitRecorder {
	recordVisit(visit: NewVisit): void;
	setEnabled(enabled: boolean): void;
	stop(): Promise<void>;
}

export function createVisitRecorder(databasePath: string, enabled: boolean): VisitRecorder {
	return new Recorder(databasePath, enabled);
}

function visitBytes(visit: NewVisit): number {
	return [visit.domain, visit.path, visit.ip, visit.user_agent, visit.accept_language].reduce(
		(bytes, value) => bytes + Buffer.byteLength(value ?? ''),
		8
	);
}

class Recorder implements VisitRecorder {
	private readonly databasePath: string;
	private enabled: boolean;
	private reported = false;
	private pool: Piscina | undefined;
	private ready = false;
	private outstanding = 0;
	private stopping: Promise<void> | undefined;

	constructor(databasePath: string, enabled: boolean) {
		this.databasePath = databasePath;
		this.enabled = enabled;
		if (enabled) this.startPool();
	}

	readonly recordVisit = (visit: NewVisit): void => {
		const pool = this.pool;
		if (!this.enabled || !this.ready || !pool || this.stopping) return;
		const bytes = visitBytes(visit);
		if (this.outstanding >= MAX_OUTSTANDING || bytes > MAX_VISIT_BYTES) {
			this.report();
			return;
		}
		this.submitVisit(pool, visit);
	};

	readonly setEnabled = (enabled: boolean): void => {
		if (this.stopping) return;
		this.enabled = enabled;
		if (enabled) this.startPool();
	};

	readonly stop = (): Promise<void> => {
		if (!this.stopping) {
			this.stopping = this.pool ? closeVisitPool(this.pool).catch(this.report) : Promise.resolve();
		}
		return this.stopping;
	};

	private submitVisit(pool: Piscina, visit: NewVisit): void {
		this.outstanding += 1;
		try {
			const recorded = pool.run(visit);
			void recorded.then(this.onRecorded, this.onRecordFailure);
		} catch {
			this.onRecordFailure();
		}
	}

	private startPool(): void {
		if (this.pool || this.stopping) return;
		try {
			const pool = createVisitPool(this.databasePath);
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
		this.report();
	};

	private readonly onReady = (): void => {
		if (!this.stopping) this.ready = true;
	};

	private readonly onPoolFailure = (): void => {
		this.report();
		void this.stop();
	};

	private readonly report = (): void => {
		if (this.reported) return;
		this.reported = true;
		try {
			console.warn('Visit tracking unavailable; some visits may not be recorded');
		} catch {
			return;
		}
	};
}
