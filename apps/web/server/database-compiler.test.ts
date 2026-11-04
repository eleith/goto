import ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';
import { watchDatabase } from './database-compiler.js';

vi.mock('typescript', () => ({
	default: {
		sys: {},
		createWatchCompilerHost: vi.fn(),
		createWatchProgram: vi.fn()
	}
}));

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test('stopping a compiler cancels pending debounce work and rejects late scheduling', async () => {
	vi.useFakeTimers();
	const schedule = vi.spyOn(globalThis, 'setTimeout');
	const host = {} as ReturnType<typeof ts.createWatchCompilerHost>;
	const close = vi.fn();
	vi.mocked(ts.createWatchCompilerHost).mockReturnValue(host);
	vi.mocked(ts.createWatchProgram).mockReturnValue({
		close,
		getProgram: vi.fn(),
		getCurrentProgram: vi.fn()
	});
	const stop = watchDatabase('file:///workspace/packages/db/dist/visit-worker.js');
	const completed = vi.fn();
	host.setTimeout!(completed, 5, 'compiler argument');
	await vi.advanceTimersByTimeAsync(5);
	expect(completed).toHaveBeenCalledExactlyOnceWith('compiler argument');

	const pending = vi.fn();
	host.setTimeout!(pending, 250);
	const alreadyQueued = schedule.mock.lastCall![0];
	expect(vi.getTimerCount()).toBe(1);
	stop();
	stop();
	expect(vi.getTimerCount()).toBe(0);
	alreadyQueued();
	host.setTimeout!(pending, 250);
	await vi.runAllTimersAsync();
	expect(pending).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
	expect(close).toHaveBeenCalledOnce();
});
