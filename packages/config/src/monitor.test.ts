import type { Stats } from 'node:fs';
import { beforeEach, expect, test, vi } from 'vitest';
import { loadConfig } from './load.js';
import { startConfigReloading } from './monitor.js';
import type { PreparedConfiguration } from './types.js';

type Listener = (current: Stats, previous: Stats) => Promise<void>;
const fs = vi.hoisted(() => ({
	watchFile: vi.fn<(path: string, options: object, listener: Listener) => void>(),
	unwatchFile: vi.fn()
}));
vi.mock('node:fs', () => fs);

function configuration(destination: string, changes: Record<string, unknown> = {}) {
	return loadConfig(
		{
			url: { app: 'https://admin.example.test' },
			auth: { credentials: { username: 'test', password: 'test-only-password' } },
			domains: {
				'go.example.test': { links: { '/docs': { url: `https://example.org/${destination}` } } }
			},
			...changes
		},
		{ env: {} }
	);
}

const initial = configuration('initial');
const reconciled = configuration('reconciled');

type ReloadOptions = Parameters<typeof startConfigReloading>[0];

function input() {
	return {
		path: '/config/goto.yaml',
		initial,
		load: vi.fn<ReloadOptions['load']>().mockResolvedValue(reconciled),
		onChange: vi.fn<ReloadOptions['onChange']>().mockReturnValue(true),
		warn: vi.fn<ReloadOptions['warn']>(),
		onError: vi.fn<ReloadOptions['onError']>()
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
	expect(options.onChange).toHaveBeenCalledExactlyOnceWith(reconciled, initial);
	await fs.watchFile.mock.calls[0]![2](previous, previous);
	expect(options.load).toHaveBeenCalledOnce();
	const replacement = configuration('replacement');
	options.load.mockResolvedValueOnce(replacement);
	await change();
	expect(options.onChange).toHaveBeenLastCalledWith(replacement, reconciled);
	stop();
});

test('serializes reads and coalesces events while startup reconciliation is active', async () => {
	const options = input();
	const first = Promise.withResolvers<PreparedConfiguration>();
	const second = Promise.withResolvers<PreparedConfiguration>();
	const next = configuration('next');
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
	first.resolve(reconciled);
	await loadingSecond.promise;
	second.resolve(next);
	const stop = await startup;
	await active;

	expect(options.load).toHaveBeenCalledTimes(2);
	expect(options.onChange.mock.calls).toEqual([
		[reconciled, initial],
		[next, reconciled]
	]);
	stop();
});

test('keeps the accepted baseline after rejection or errors and can recover', async () => {
	const options = input();
	const stop = await startConfigReloading(options);
	const rejected = configuration('rejected');
	options.load.mockResolvedValueOnce(rejected);
	options.onChange.mockReturnValueOnce(false);
	await change();
	const failure = new Error('read failed');
	options.load.mockRejectedValueOnce(failure);
	options.onError.mockImplementationOnce(() => {
		throw new Error('diagnostic failed');
	});
	await change();
	const recovered = configuration('recovered');
	options.load.mockResolvedValueOnce(recovered);
	await change();

	expect(options.onChange.mock.calls).toEqual([
		[reconciled, initial],
		[rejected, reconciled],
		[recovered, reconciled]
	]);
	expect(options.onError).toHaveBeenCalledExactlyOnceWith(failure);
	stop();
});

test.each(['resolve', 'reject'])('stop suppresses late %s and pending reloads', async (result) => {
	const options = input();
	const stop = await startConfigReloading(options);
	const read = Promise.withResolvers<PreparedConfiguration>();
	options.load.mockReturnValueOnce(read.promise);
	const active = change();
	await Promise.resolve();
	void change();
	stop();
	stop();
	if (result === 'resolve') read.resolve(configuration('too-late'));
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

test('awaits policy application before accepting another candidate and drains it on stop', async () => {
	const options = input();
	const stop = await startConfigReloading(options);
	const applied = Promise.withResolvers<boolean>();
	const next = configuration('next');
	options.load.mockResolvedValueOnce(next);
	options.onChange.mockReturnValueOnce(applied.promise);
	const applying = change();
	await Promise.resolve();
	await Promise.resolve();
	expect(options.onChange).toHaveBeenLastCalledWith(next, reconciled);
	void change();
	const stopping = stop();
	let stopped = false;
	void stopping.then(() => {
		stopped = true;
	});
	await Promise.resolve();
	expect(stopped).toBe(false);
	expect(options.load).toHaveBeenCalledTimes(2);
	applied.resolve(true);
	await applying;
	await stopping;
	expect(options.load).toHaveBeenCalledTimes(2);
});

test.each([
	['app origin', { url: { app: 'https://different.example.test' } }],
	[
		'authentication',
		{ auth: { credentials: { username: 'changed', password: 'changed-test-password' } } }
	],
	['shared database', { database: { path: './data/moved.sqlite' } }],
	['worker database', { database: { worker_path: './data/moved.sqlite' } }],
	['disabling detailed analytics', { analytics: { retention_months: 0 } }]
] as const)(
	'keeps a candidate with a changed %s out of the service callback',
	async (_name, changes) => {
		const options = input();
		options.load.mockResolvedValueOnce(configuration('blocked', changes));
		const stop = await startConfigReloading(options);

		expect(options.onChange).not.toHaveBeenCalled();
		expect(options.warn).toHaveBeenCalledOnce();
		expect(options.warn).toHaveBeenCalledWith(
			expect.stringContaining('requires a coordinated restart')
		);
		await change();
		expect(options.onChange).toHaveBeenCalledExactlyOnceWith(reconciled, initial);
		await stop();
	}
);

test('enabling detailed analytics must also wait for a coordinated restart', async () => {
	const options = input();
	options.initial = configuration('initial', { analytics: { retention_months: 0 } });
	const stop = await startConfigReloading(options);

	expect(options.onChange).not.toHaveBeenCalled();
	expect(options.warn).toHaveBeenCalledExactlyOnceWith(
		'Detailed analytics change requires a coordinated restart; previous configuration remains active'
	);
	await stop();
});

test('allows a retention increase but rejects a later reduction against the accepted policy', async () => {
	const options = input();
	const extended = configuration('extended', { analytics: { retention_months: 9 } });
	options.load.mockResolvedValueOnce(extended);
	const stop = await startConfigReloading(options);
	expect(options.onChange).toHaveBeenCalledExactlyOnceWith(extended, initial);

	options.load.mockResolvedValueOnce(
		configuration('blocked', { analytics: { retention_months: 3 } })
	);
	await change();
	expect(options.onChange).toHaveBeenCalledOnce();
	expect(options.warn).toHaveBeenCalledExactlyOnceWith(
		'Retention reduction requires a coordinated restart; previous configuration remains active'
	);

	const corrected = configuration('corrected', { analytics: { retention_months: 9 } });
	options.load.mockResolvedValueOnce(corrected);
	await change();
	expect(options.onChange).toHaveBeenLastCalledWith(corrected, extended);
	await stop();
});

test('stop prevents a queued read from starting', async () => {
	const options = input();
	const stop = await startConfigReloading(options);
	const pending = change();
	stop();
	await pending;

	expect(options.load).toHaveBeenCalledOnce();
});
