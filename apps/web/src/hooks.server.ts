import { building } from '$app/env';
import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { requestContext } from '#lib/server/request-context.js';
import { authHandle } from '#lib/server/auth/index.js';
import { authGate } from '#lib/server/auth/access.js';

export const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	const headers = new Headers(response.headers);
	headers.set('x-content-type-options', 'nosniff');
	headers.set('referrer-policy', 'strict-origin-when-cross-origin');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};

export const applicationContext: Handle = ({ event, resolve }) => {
	if (building) return resolve(event);
	const captured =
		requestContext(event.request) ?? (event.platform?.req && requestContext(event.platform.req));
	const application = captured?.application ?? event.platform?.application;
	const snapshot = captured?.snapshot ?? event.platform?.snapshot ?? application?.currentSnapshot();
	if (!application || !snapshot) {
		return new Response('Unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
	}
	event.locals.application = application;
	event.locals.snapshot = snapshot;
	return resolve(event);
};

export const adminOriginGate: Handle = ({ event, resolve }) => {
	if (
		event.route.id?.startsWith('/(admin)') &&
		event.url.origin !== event.locals.snapshot?.configuration.site.url
	) {
		return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
	}
	return resolve(event);
};

export const handle = sequence(
	securityHeaders,
	applicationContext,
	adminOriginGate,
	authHandle,
	authGate
);
