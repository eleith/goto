import { Logger as TsLogger } from 'tslog';

let logType: 'pretty' | 'json' = 'pretty';
if (process.env.NODE_ENV === 'production') logType = 'json';

export const logger = new TsLogger({
	name: 'goto-worker',
	type: logType,
	stack: { capture: 'off' }
});

export type Logger = typeof logger;
