import type { GotoConfiguration } from '@goto/config';
import type { openDb } from '@goto/db';

export interface WorkerContext {
	config: GotoConfiguration;
	db: Awaited<ReturnType<typeof openDb>>;
}
