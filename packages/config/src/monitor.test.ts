import type { Stats } from 'node:fs';
import { beforeEach, expect, test, vi } from 'vitest';
import { startConfigReloading } from './monitor.js';

type Listener = (current: Stats, previous: Stats) => Promise<void>;
const fs = vi.hoisted(() => ({
	watchFile: vi.fn<(path: string, options: object, listener: Listener) => void>(),
	unwatchFile: vi.fn()
}));
vi.mock('node:fs', () => fs);

function input() {
	return {
		path: '/config/goto.yaml',
		initial: 'initial',
		load: vi.fn<(path: string) => Promise<string>>().mockResolvedValue('reconciled'),
		onChange: vi.fn<(next: string, previous: string) => boolean>().mockReturnValue(true),
		onError: vi.fn<(error: unknown) => void>()
	};
}

const previous = { ino: 10, mtimeMs: 100, ctimeMs: 100, size: 50 } as Stats;
const replaced = { ...previous, ino: 11 } as Stats;
function change(): Promise<void> {
	return fs.watchFile.mock.calls[0]![2](replaced, previous);
}

beforeEach(() => vi.resetAllMocks());

test('polls the path and reconciles the initial read, including atomic replacement', async () => {
	const options = input();
	const stop = await startConfigReloading(options);

	expect(fs.watchFile).toHaveBeenCalledExactlyOnceWith(
		options.path,
		{ interval: 1000, persistent: false },
		expect.any(Function)
	);
	expect(options.onChange).toHaveBeenCalledExactlyOnceWith('reconciled', 'initial');
	await fs.watchFile.mock.calls[0]![2](previous, previous);
	expect(options.load).toHaveBeenCalledOnce();
	options.load.mockResolvedValueOnce('replacement');
	await change();
	expect(options.onChange).toHaveBeenLastCalledWith('replacement', 'reconciled');
	stop();
});

test('serializes reads and coalesces events while startup reconciliation is active', async () => {
	const options = input();
	const first = Promise.withResolvers<string>();
	const second = Promise.withResolvers<string>();
	const loadingSecond = Promise.withResolvers<void>();
	options.load.mockReturnValueOnce(first.promise).mockImplementationOnce(() => {
		loadingSecond.resolve();
		return second.promise;
	});
	const startup = startConfigReloading(options);
	await Promise.resolve();
	const active = change();
	void change();
	void change();
	expect(options.load).toHaveBeenCalledOnce();
	first.resolve('first');
	await loadingSecond.promise;
	second.resolve('second');
	const stop = await startup;
	await active;

	expect(options.load).toHaveBeenCalledTimes(2);
	expect(options.onChange.mock.calls).toEqual([
		['first', 'initial'],
		['second', 'first']
	]);
	stop();
});

test('keeps the accepted baseline after rejection or errors and can recover', async () => {
	const options = input();
	const stop = await startConfigReloading(options);
	options.load.mockResolvedValueOnce('rejected');
	options.onChange.mockReturnValueOnce(false);
	await change();
	const failure = new Error('read failed');
	options.load.mockRejectedValueOnce(failure);
	options.onError.mockImplementationOnce(() => {
		throw new Error('diagnostic failed');
	});
	await change();
	options.load.mockResolvedValueOnce('recovered');
	await change();

	expect(options.onChange.mock.calls).toEqual([
		['reconciled', 'initial'],
		['rejected', 'reconciled'],
		['recovered', 'reconciled']
	]);
	expect(options.onError).toHaveBeenCalledExactlyOnceWith(failure);
	stop();
});

test.each(['resolve', 'reject'])('stop suppresses late %s and pending reloads', async (result) => {
	const options = input();
	const stop = await startConfigReloading(options);
	const read = Promise.withResolvers<string>();
	options.load.mockReturnValueOnce(read.promise);
	const active = change();
	await Promise.resolve();
	void change();
	stop();
	stop();
	if (result === 'resolve') read.resolve('too late');
	else read.reject(new Error('too late'));
	await active;
	await change();

	expect(fs.unwatchFile).toHaveBeenCalledExactlyOnceWith(
		options.path,
		fs.watchFile.mock.calls[0]![2]
	);
	expect(options.load).toHaveBeenCalledTimes(2);
	expect(options.onChange).toHaveBeenCalledOnce();
	expect(options.onError).not.toHaveBeenCalled();
});

test('stop prevents a queued read from starting', async () => {
	const options = input();
	const stop = await startConfigReloading(options);
	const pending = change();
	stop();
	await pending;

	expect(options.load).toHaveBeenCalledOnce();
});
