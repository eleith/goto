import type { GotoConfiguration, PreparedConfiguration } from '@goto/config';
import type { openDb } from '@goto/db';

export interface WorkerContext {
	config: GotoConfiguration;
	domains: PreparedConfiguration['domains'];
	db: Awaited<ReturnType<typeof openDb>>;
}
