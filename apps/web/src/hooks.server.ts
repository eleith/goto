import { building } from '$app/env';
import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { requestApplication } from '#lib/server/request-context.js';

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
	const application =
		requestApplication(event.request) ??
		event.platform?.application ??
		(event.platform?.req && requestApplication(event.platform.req));
	if (!application) {
		return new Response('Unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
	}
	event.locals.application = application;
	return resolve(event);
};

export const adminOriginGate: Handle = ({ event, resolve }) => {
	if (
		event.route.id?.startsWith('/(admin)') &&
		event.url.origin !== event.locals.application?.configuration.site.url
	) {
		return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
	}
	return resolve(event);
};

export const handle = sequence(securityHeaders, applicationContext, adminOriginGate);
