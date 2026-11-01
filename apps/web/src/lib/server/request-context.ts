import type { IncomingMessage } from 'node:http';
import type { Application } from './application.js';

const applicationKey = Symbol.for('goto.request.application');
type RequestContext = (IncomingMessage | Request) & {
	[applicationKey]?: { application: Application; origin?: string };
};

export function bindApplication(
	request: IncomingMessage | Request,
	application: Application,
	origin?: string
): void {
	const context = { application, ...(origin === undefined ? {} : { origin }) };
	Object.defineProperty(request, applicationKey, { value: context });
}

export function requestApplication(request: IncomingMessage | Request): Application | undefined {
	return (request as RequestContext)[applicationKey]?.application;
}

export function requestOrigin(request: IncomingMessage | Request): string | undefined {
	return (request as RequestContext)[applicationKey]?.origin;
}
