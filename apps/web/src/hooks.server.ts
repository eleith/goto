import { loadConfigFile } from '@goto/config';
import { building } from '$app/env';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';

let adminOrigin: string | undefined;

export const init: ServerInit = async () => {
	if (building) return;
	const { configuration } = await loadConfigFile();
	adminOrigin = configuration.site.url;
};

export const handle: Handle = async ({ event, resolve }) => {
	let response: Response;
	if (event.route.id === '/schema.json' && event.url.origin !== adminOrigin) {
		response = new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
	} else {
		response = await resolve(event);
	}
	const headers = new Headers(response.headers);
	headers.set('x-content-type-options', 'nosniff');
	headers.set('referrer-policy', 'strict-origin-when-cross-origin');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};
