import { expect, test, vi } from 'vitest';
import { createShutdown } from './lifecycle.js';

test('shutdown is idempotent and waits for the worker before closing its backend', async () => {
	const workerStopped = Promise.withResolvers<void>();
	const workflowWorker = { stop: vi.fn(() => workerStopped.promise) };
	const backend = { stop: vi.fn(async () => {}) };
	const stopWatch = vi.fn();
	const stop = createShutdown({ workflowWorker, backend, stopWatch });
	const stopping = stop();
	expect(stop()).toBe(stopping);
	expect(workflowWorker.stop).toHaveBeenCalledOnce();
	expect(stopWatch).toHaveBeenCalledOnce();
	expect(stopWatch.mock.invocationCallOrder[0]).toBeLessThan(
		workflowWorker.stop.mock.invocationCallOrder[0]!
	);
	expect(backend.stop).not.toHaveBeenCalled();
	workerStopped.resolve();
	await stopping;
	expect(backend.stop).toHaveBeenCalledOnce();
});

test('a failed monitor stop still stops the worker and closes the backend', async () => {
	const failure = new Error('Monitor stop failed');
	const stopWatch = vi.fn(() => {
		throw failure;
	});
	const workflowWorker = { stop: vi.fn(async () => {}) };
	const backend = { stop: vi.fn(async () => {}) };
	const stop = createShutdown({ stopWatch, workflowWorker, backend });

	await expect(stop()).rejects.toBe(failure);
	expect(workflowWorker.stop).toHaveBeenCalledOnce();
	expect(backend.stop).toHaveBeenCalledOnce();
});

test('a failed worker stop still closes the workflow backend', async () => {
	const failure = new Error('Worker stop failed');
	const workflowWorker = {
		stop: vi.fn(async () => {
			throw failure;
		})
	};
	const backend = { stop: vi.fn(async () => {}) };
	const stop = createShutdown({ workflowWorker, backend });

	await expect(stop()).rejects.toBe(failure);
	expect(backend.stop).toHaveBeenCalledOnce();
});
