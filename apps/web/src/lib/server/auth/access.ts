import { error, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { themeStyleTag } from '../appearance.js';
import { localRedirect } from '../local-redirect.js';

export const authGate: Handle = async ({ event, resolve }) => {
	if (building || !event.route.id?.startsWith('/(admin)')) return resolve(event);
	if (event.route.id.startsWith('/(admin)/(auth)')) {
		const session = await event.locals.auth();
		if (!session) {
			const accept = event.request.headers.get('accept') ?? '';
			if (event.request.method === 'GET' && accept.includes('text/html')) {
				const callbackUrl = localRedirect(
					event.url.pathname + event.url.search,
					event.url.origin,
					'/admin'
				);
				throw redirect(303, `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
			}
			throw error(403, 'Not authorized.');
		}
	}
	const appearance = event.locals.snapshot.configuration.appearance;
	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('</head>', `${themeStyleTag(appearance)}</head>`)
	});
};
