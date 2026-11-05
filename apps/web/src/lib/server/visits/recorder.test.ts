import { EventEmitter } from 'node:events';
import type { NewVisit } from '@goto/db';
import { Piscina } from 'piscina';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createVisitRecorder } from './recorder.js';

vi.mock('piscina', () => ({ Piscina: vi.fn() }));

let pool: EventEmitter & { run: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
let initialized: ReturnType<typeof Promise.withResolvers<void>>;
let writes: ReturnType<typeof Promise.withResolvers<void>>[];

const visit: NewVisit = {
	domain: 'go.example.test',
	path: '/docs',
	visited_at: 1_700_000_000_000,
	ip: '2001:db8::1',
	user_agent: null,
	accept_language: null
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	initialized = Promise.withResolvers<void>();
	writes = [];
	pool = Object.assign(new EventEmitter(), {
		run: vi.fn((_value: unknown, options?: { name: string }) => {
			if (options?.name === 'ready') return initialized.promise;
			if (options?.name === 'close') return Promise.resolve();
			const write = Promise.withResolvers<void>();
			writes.push(write);
			return write.promise;
		}),
		close: vi.fn(async () => {})
	});
	vi.mocked(Piscina).mockImplementation(function () {
		return pool as unknown as Piscina;
	});
});

afterEach(() => {
	for (const write of writes) write.resolve();
	vi.restoreAllMocks();
});

test('bounds unsettled visits and releases capacity after a failed insert', async () => {
	const recorder = createVisitRecorder('/data/goto.sqlite', true);
	recorder.recordVisit(visit);
	expect(writes).toHaveLength(0);
	initialized.resolve();
	await initialized.promise;
	for (let index = 0; index < 1000; index++) recorder.recordVisit(visit);
	recorder.recordVisit(visit);
	expect(writes).toHaveLength(1000);
	writes[0]!.reject(new Error('private database detail'));
	await Promise.resolve();
	recorder.recordVisit(visit);
	expect(writes).toHaveLength(1001);
	expect(console.warn).toHaveBeenCalledExactlyOnceWith(
		'Visit tracking unavailable; some visits may not be recorded'
	);
	await recorder.stop();
});

test('drops oversized events without changing the payload', async () => {
	const recorder = createVisitRecorder('/data/goto.sqlite', true);
	initialized.resolve();
	await initialized.promise;
	const oversized = { ...visit, user_agent: 'x'.repeat(32 * 1024) };
	recorder.recordVisit(oversized);
	expect(writes).toHaveLength(0);
	expect(oversized.user_agent).toHaveLength(32 * 1024);
	await recorder.stop();
});

test('disabled collection starts no worker and can later enable and pause admission', async () => {
	const recorder = createVisitRecorder('/data/goto.sqlite', false);
	recorder.recordVisit(visit);
	expect(Piscina).not.toHaveBeenCalled();
	recorder.setEnabled(true);
	initialized.resolve();
	await initialized.promise;
	recorder.recordVisit(visit);
	expect(writes).toHaveLength(1);
	recorder.setEnabled(false);
	recorder.recordVisit(visit);
	expect(writes).toHaveLength(1);
	recorder.setEnabled(true);
	recorder.recordVisit(visit);
	expect(writes).toHaveLength(2);
	expect(Piscina).toHaveBeenCalledOnce();
	await recorder.stop();
});

test('stops admission and waits for database and pool closure', async () => {
	const closed = Promise.withResolvers<void>();
	const poolClosed = Promise.withResolvers<void>();
	const recorder = createVisitRecorder('/data/goto.sqlite', true);
	initialized.resolve();
	await initialized.promise;
	pool.run.mockImplementation(() => closed.promise);
	pool.close.mockReturnValue(poolClosed.promise);
	const stop = recorder.stop();
	expect(Piscina).toHaveBeenCalledWith(
		expect.objectContaining({
			maxThreads: 1,
			concurrentTasksPerWorker: 1,
			stricterFIFO: true,
			maxQueue: 1000
		})
	);
	expect(recorder.stop()).toBe(stop);
	recorder.recordVisit(visit);
	expect(pool.run).toHaveBeenLastCalledWith(null, { name: 'close' });
	expect(pool.close).toHaveBeenCalledOnce();
	closed.resolve();
	let stopped = false;
	void stop.then(() => {
		stopped = true;
	});
	await Promise.resolve();
	expect(stopped).toBe(false);
	poolClosed.resolve();
	await stop;
});

test('initialization failures disable capture without propagating private errors', async () => {
	const recorder = createVisitRecorder('/data/goto.sqlite', true);
	initialized.reject(new Error('private database path'));
	await Promise.resolve();
	recorder.recordVisit(visit);
	await recorder.stop();
	expect(writes).toHaveLength(0);
	expect(pool.close).toHaveBeenCalledOnce();
	expect(console.warn).toHaveBeenCalledExactlyOnceWith(
		'Visit tracking unavailable; some visits may not be recorded'
	);
});
