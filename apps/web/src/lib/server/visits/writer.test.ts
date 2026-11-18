import { EventEmitter } from 'node:events';
import type { NewVisit } from '@goto/db';
import { Piscina } from 'piscina';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createVisitWriter } from './writer.js';

vi.mock('piscina', () => ({ Piscina: vi.fn() }));

let writerThread: EventEmitter & { run: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
let initialized: ReturnType<typeof Promise.withResolvers<void>>;
let writes: ReturnType<typeof Promise.withResolvers<void>>[];

const visit: NewVisit = {
	domain: 'go.example.test',
	path: '/docs',
	outcome: 'valid',
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
	writerThread = Object.assign(new EventEmitter(), {
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
		return writerThread as unknown as Piscina;
	});
});

afterEach(() => {
	for (const write of writes) write.resolve();
	vi.restoreAllMocks();
});

test('bounds unsettled visits and reports queue and insert failures separately', async () => {
	const writer = createVisitWriter('/data/goto.sqlite');
	writer.queueVisit(visit);
	expect(writes).toHaveLength(0);
	let ready = false;
	void writer.waitUntilReady().then(() => {
		ready = true;
	});
	await Promise.resolve();
	expect(ready).toBe(false);
	initialized.resolve();
	await writer.waitUntilReady();
	expect(ready).toBe(true);
	for (let index = 0; index < 1000; index++) writer.queueVisit(visit);
	writer.queueVisit(visit);
	writer.queueVisit(visit);
	expect(writes).toHaveLength(1000);
	writes[0]!.reject(new Error('private database detail'));
	await Promise.resolve();
	writer.queueVisit(visit);
	expect(writes).toHaveLength(1001);
	expect(vi.mocked(console.warn).mock.calls).toEqual([
		['Visit recording queue full (1000 outstanding); dropping visit'],
		['Visit tracking unavailable; some visits may not be recorded']
	]);
	await writer.stop();
});

test('drops whole oversized events and warns once without logging their payload', async () => {
	const writer = createVisitWriter('/data/goto.sqlite');
	initialized.resolve();
	await writer.waitUntilReady();
	const oversized = { ...visit, user_agent: 'x'.repeat(32 * 1024) };
	writer.queueVisit(oversized);
	writer.queueVisit(oversized);
	expect(writes).toHaveLength(0);
	expect(oversized.user_agent).toHaveLength(32 * 1024);
	expect(console.warn).toHaveBeenCalledExactlyOnceWith(
		'Visit payload exceeds 32 KiB; dropping visit'
	);
	await writer.stop();
});

test('stops admission and waits for database and writer thread closure', async () => {
	const closed = Promise.withResolvers<void>();
	const threadClosed = Promise.withResolvers<void>();
	const writer = createVisitWriter('/data/goto.sqlite');
	initialized.resolve();
	await writer.waitUntilReady();
	writerThread.run.mockImplementation(() => closed.promise);
	writerThread.close.mockReturnValue(threadClosed.promise);
	const stop = writer.stop();
	expect(Piscina).toHaveBeenCalledWith(
		expect.objectContaining({
			maxThreads: 1,
			concurrentTasksPerWorker: 1,
			stricterFIFO: true,
			maxQueue: 1000
		})
	);
	expect(writer.stop()).toBe(stop);
	writer.queueVisit(visit);
	expect(writerThread.run).toHaveBeenLastCalledWith(null, { name: 'close' });
	expect(writerThread.close).toHaveBeenCalledOnce();
	closed.resolve();
	let stopped = false;
	void stop.then(() => {
		stopped = true;
	});
	await Promise.resolve();
	expect(stopped).toBe(false);
	threadClosed.resolve();
	await stop;
});

test('initialization failures reject readiness safely and disable capture', async () => {
	const writer = createVisitWriter('/data/goto.sqlite');
	const ready = writer.waitUntilReady();
	initialized.reject(new Error('private database path'));
	await expect(ready).rejects.toThrow('Visit recording initialization failed');
	writer.queueVisit(visit);
	await writer.stop();
	expect(writes).toHaveLength(0);
	expect(writerThread.close).toHaveBeenCalledOnce();
	expect(console.warn).toHaveBeenCalledExactlyOnceWith(
		'Visit tracking unavailable; some visits may not be recorded'
	);
});
