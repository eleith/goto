import { redirect } from '@sveltejs/kit';
import { localRedirect } from '#lib/server/local-redirect.js';
import type { PageServerLoad } from './$types';

const publicErrorCodes = new Set([
	'CredentialsSignin',
	'SessionRequired',
	'RateLimited',
	'NetworkError',
	'AuthError'
]);

export const load: PageServerLoad = async ({ url, locals }) => {
	const callbackUrl = localRedirect(url.searchParams.get('callbackUrl'), url.origin, '/admin');
	const session = await locals.auth();
	if (session) redirect(303, callbackUrl);

	const configuredAuth = locals.snapshot.configuration.auth;
	const auth = configuredAuth.oidc
		? { type: 'oidc' as const, name: configuredAuth.oidc.name }
		: { type: 'credentials' as const };
	const requestedError = url.searchParams.get('error');
	let errorCode = requestedError;
	if (requestedError !== null && !publicErrorCodes.has(requestedError)) {
		errorCode = 'unknownAuthError';
	}

	return { callbackUrl, auth, errorCode };
};
