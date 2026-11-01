import type { Application } from '../src/lib/server/application.js';

export function createApplicationLifecycle(load: () => Promise<Application>) {
	let application: Promise<Application> | undefined;
	let stopping: Promise<void> | undefined;

	function start(): Promise<Application> {
		if (stopping) return Promise.reject(new Error('Application is stopped'));
		return (application ??= load());
	}

	function stop(): Promise<void> {
		return (stopping ??= (async () => {
			const current = await application;
			await current?.close?.();
		})());
	}

	return { start, stop };
}
