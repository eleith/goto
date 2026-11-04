import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export function watchDatabase(workerUrl: string): () => void {
	const host = ts.createWatchCompilerHost(
		fileURLToPath(new URL('../tsconfig.build.json', workerUrl)),
		{ noEmitOnError: true, preserveWatchOutput: true },
		ts.sys
	);
	const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
	let stopped = false;

	// TypeScript 6 does not cancel every compilation debounce in close().
	host.setTimeout = (callback, delay, ...args) => {
		if (stopped) return;
		const timer = setTimeout(() => {
			pendingTimers.delete(timer);
			if (!stopped) callback(...args);
		}, delay);
		pendingTimers.add(timer);
		return timer;
	};
	host.clearTimeout = (timer) => {
		pendingTimers.delete(timer);
		clearTimeout(timer);
	};

	const compiler = ts.createWatchProgram(host);
	return () => {
		if (stopped) return;
		stopped = true;
		for (const timer of pendingTimers) clearTimeout(timer);
		pendingTimers.clear();
		compiler.close();
	};
}
