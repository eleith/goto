import { expect, test, vi } from 'vitest';
import { createEngineLogger } from './engine-logger.js';

test('keeps structured engine categories without raw messages', () => {
	const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	const logger = createEngineLogger(log);
	const privateError = new Error('private error details');
	const privateInput = { password: 'private workflow input' };
	logger.debug('private debug details', privateInput);
	logger.info('private workflow inputs', privateInput);
	logger.warn('Worker schedule tick failed: private schedule', privateError);
	logger.error('private database path', privateError, privateInput);
	expect(log.debug).toHaveBeenCalledExactlyOnceWith('Workflow engine debug');
	expect(log.info).toHaveBeenCalledExactlyOnceWith('Workflow engine info');
	expect(log.warn).toHaveBeenCalledExactlyOnceWith('Workflow engine schedule poll failed');
	expect(log.error).toHaveBeenCalledExactlyOnceWith('Workflow engine error');
});

test('only includes a validated execution ID and rejects a trailing newline', () => {
	const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	const logger = createEngineLogger(log);
	const id = '00000000-0000-4000-8000-000000000001';
	const message = `Critical error during workflow execution for run ${id}:`;
	logger.error(message);
	logger.error(`${message}\n`);
	expect(log.error).toHaveBeenNthCalledWith(
		1,
		{ workflowRunId: id },
		'Workflow engine execution failed'
	);
	expect(log.error).toHaveBeenNthCalledWith(2, 'Workflow engine execution failed');
});
