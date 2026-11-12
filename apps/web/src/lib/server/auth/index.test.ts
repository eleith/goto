import { validateConfig } from '@goto/config';
import { parseSetCookieHeader } from 'better-auth/cookies';
import { expect, test, vi } from 'vitest';
import { createAuthentication } from './index.js';

vi.mock('$app/env', () => ({ building: false }));

const credentials = { username: 'cookie-test-admin', password: 'cookie-test-password' };
const foreignCookies =
	'better-auth.session_token=other-app-token; better-auth.session_data=other-app-data';

function authentication(origin: string) {
	const { configuration } = validateConfig(
		{
			url: { app: origin },
			auth: { secret: 'cookie-test-secret-with-at-least-thirty-two-characters', credentials },
			domains: { 'go.example.test': { links: {} } }
		},
		{ env: {} }
	);
	return createAuthentication(configuration);
}

function requestCookies(response: Response): string {
	const cookies = parseSetCookieHeader(response.headers.get('set-cookie') ?? '');
	return [...cookies]
		.filter(([, attributes]) => attributes.value)
		.map(([name, attributes]) => `${name}=${attributes.value}`)
		.join('; ');
}

test.each([
	{ origin: 'http://localhost:5173', prefix: 'goto.' },
	{ origin: 'https://goto.example.test', prefix: '__Secure-goto.' }
])('isolates sign-in and sign-out cookies at $origin', async ({ origin, prefix }) => {
	const auth = authentication(origin);
	const headers = {
		origin,
		'content-type': 'application/json',
		'x-real-ip': '192.0.2.44',
		cookie: foreignCookies
	};
	const login = await auth.handler(
		new Request(`${origin}/auth/sign-in/credentials`, {
			method: 'POST',
			headers,
			body: JSON.stringify(credentials)
		})
	);
	expect(login.status).toBe(200);
	const issued = parseSetCookieHeader(login.headers.get('set-cookie') ?? '');
	expect([...issued.keys()]).toContain(`${prefix}session_token`);
	expect([...issued.keys()]).toContain(`${prefix}session_data`);
	expect([...issued.keys()].every((name) => name.startsWith(prefix))).toBe(true);

	const cookie = `${requestCookies(login)}; ${foreignCookies}`;
	const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
	expect(session?.user.name).toBe(credentials.username);

	const logout = await auth.handler(
		new Request(`${origin}/auth/sign-out`, {
			method: 'POST',
			headers: { ...headers, cookie },
			body: '{}'
		})
	);
	expect(logout.status).toBe(200);
	const cleared = parseSetCookieHeader(logout.headers.get('set-cookie') ?? '');
	expect([...cleared.keys()]).toContain(`${prefix}session_token`);
	expect([...cleared.keys()]).toContain(`${prefix}session_data`);
	expect([...cleared.keys()].every((name) => name.startsWith(prefix))).toBe(true);
});
