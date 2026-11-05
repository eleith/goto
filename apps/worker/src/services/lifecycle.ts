import type { Server } from 'node:http';
import type { Worker as WorkflowWorker } from 'openworkflow';
import type { BackendSqlite } from 'openworkflow/sqlite';

export interface ShutdownResources {
	workflowWorker?: Pick<WorkflowWorker, 'stop'>;
	server?: Server;
	backend?: Pick<BackendSqlite, 'stop'>;
	stopWatch?: () => void;
}

export function createShutdown(resources: ShutdownResources): () => Promise<void> {
	let stopping: Promise<void> | undefined;
	return () => (stopping ??= stopResources(resources));
}

async function stopResources(resources: ShutdownResources): Promise<void> {
	const failures: unknown[] = [];
	try {
		resources.stopWatch?.();
	} catch (error) {
		failures.push(error);
	}
	const serverClosed = new Promise<Error | undefined>((resolve) => {
		try {
			if (resources.server?.listening) resources.server.close(resolve);
			else resolve(undefined);
		} catch (error) {
			resolve(error instanceof Error ? error : new Error('Health server shutdown failed'));
		}
	});
	try {
		await resources.workflowWorker?.stop();
	} catch (error) {
		failures.push(error);
	}
	const serverError = await serverClosed;
	if (serverError) failures.push(serverError);
	try {
		await resources.backend?.stop();
	} catch (error) {
		failures.push(error);
	}
	if (failures.length > 0) throw failures[0];
}
