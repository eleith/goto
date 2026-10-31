import { loadConfigFile } from '@goto/config';
import { building } from '$app/env';
import { sequence, type Handle, type ServerInit } from '@sveltejs/kit/hooks';

let adminOrigin: string | undefined;

export const init: ServerInit = async () => {
	if (building) return;
	const { configuration } = await loadConfigFile();
	adminOrigin = configuration.site.url;
};

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

export const adminOriginGate: Handle = ({ event, resolve }) => {
	if (event.route.id?.startsWith('/(admin)') && event.url.origin !== adminOrigin) {
		return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
	}
	return resolve(event);
};

export const handle = sequence(securityHeaders, adminOriginGate);
