import type { Logger as EngineLogger } from 'openworkflow';
import type { Logger } from './logger.js';

const operationalMessages = [
	['Worker tick failed:', 'Workflow engine worker poll failed'],
	['Worker schedule tick failed:', 'Workflow engine schedule poll failed'],
	['Heartbeat failed:', 'Workflow engine heartbeat failed'],
	['Critical error during workflow execution for run ', 'Workflow engine execution failed']
] as const;

const executionError =
	/^Critical error during workflow execution for run ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}):$/;

function safeMessage(message: string, level: 'debug' | 'info' | 'warn' | 'error'): string {
	if (typeof message === 'string') {
		for (const [prefix, fixedMessage] of operationalMessages) {
			if (message.startsWith(prefix)) return fixedMessage;
		}
	}
	return `Workflow engine ${level}`;
}

export function createEngineLogger(
	log: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>
): EngineLogger {
	return {
		debug: (message) => log.debug(safeMessage(message, 'debug')),
		info: (message) => log.info(safeMessage(message, 'info')),
		warn: (message) => log.warn(safeMessage(message, 'warn')),
		error: (message) => {
			const text = safeMessage(message, 'error');
			const match = typeof message === 'string' ? executionError.exec(message) : null;
			// Reject a trailing newline accepted by the regex's end anchor.
			if (match && match[0] === message) log.error({ workflowRunId: match[1] }, text);
			else log.error(text);
		}
	};
}
