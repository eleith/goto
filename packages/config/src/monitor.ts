import { watchFile, unwatchFile, type Stats } from 'node:fs';

export async function startConfigReloading<T>({
	path,
	initial,
	load,
	onChange,
	onError
}: {
	path: string;
	initial: T;
	load: (path: string) => Promise<T>;
	onChange: (next: T, previous: T) => boolean | Promise<boolean>;
	/** Receives raw failures; the caller is responsible for safe diagnostics. */
	onError: (error: unknown) => void;
}): Promise<() => Promise<void>> {
	let accepted = initial;
	let stopped = false;
	let pending = false;
	let active: Promise<void> | undefined;

	async function run(): Promise<void> {
		try {
			while (!stopped && pending) {
				pending = false;
				try {
					const next = await load(path);
					if (stopped) return;
					const applied = await onChange(next, accepted);
					if (applied && !stopped) accepted = next;
				} catch (error) {
					if (stopped) return;
					try {
						onError(error);
					} catch {
						// Diagnostic failures must not poison subsequent reloads.
					}
				}
			}
		} finally {
			active = undefined;
		}
	}

	function reload(): Promise<void> {
		if (stopped) return Promise.resolve();
		pending = true;
		// Defer the read so same-turn events coalesce and stop can suppress scheduled work.
		active ??= Promise.resolve().then(run);
		return active;
	}

	function listener(current: Stats, previous: Stats): Promise<void> {
		if (
			stopped ||
			(current.ino === previous.ino &&
				current.mtimeMs === previous.mtimeMs &&
				current.ctimeMs === previous.ctimeMs &&
				current.size === previous.size)
		) {
			return Promise.resolve();
		}
		return reload();
	}

	async function stop(): Promise<void> {
		if (!stopped) {
			stopped = true;
			pending = false;
			unwatchFile(path, listener);
		}
		await active;
	}

	// Poll the path so atomic saves and deletion/recreation remain observable.
	watchFile(path, { interval: 1000, persistent: false }, listener);
	// Close the gap between the caller's initial read and watcher registration.
	await reload();
	return stop;
}
