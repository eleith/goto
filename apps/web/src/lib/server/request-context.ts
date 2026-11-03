import type { IncomingMessage } from 'node:http';
import type { Application } from './application.js';
import type { ConfigurationSnapshot } from './snapshot.js';

export interface ApplicationContext {
	readonly application: Application;
	readonly snapshot: ConfigurationSnapshot;
	readonly origin?: string;
}

const applicationKey = Symbol.for('goto.request.application');
type CapturedRequest = (IncomingMessage | Request) & { [applicationKey]?: ApplicationContext };

export function bindApplication(
	request: IncomingMessage | Request,
	application: Application,
	origin?: string,
	snapshot: ConfigurationSnapshot = application.currentSnapshot()
): void {
	const context = Object.freeze({
		application,
		snapshot,
		...(origin === undefined ? {} : { origin })
	});
	Object.defineProperty(request, applicationKey, { value: context });
}

export function requestContext(request: IncomingMessage | Request): ApplicationContext | undefined {
	return (request as CapturedRequest)[applicationKey];
}

export function requestApplication(request: IncomingMessage | Request): Application | undefined {
	return requestContext(request)?.application;
}

export function requestSnapshot(
	request: IncomingMessage | Request
): ConfigurationSnapshot | undefined {
	return requestContext(request)?.snapshot;
}

export function requestOrigin(request: IncomingMessage | Request): string | undefined {
	return requestContext(request)?.origin;
}
