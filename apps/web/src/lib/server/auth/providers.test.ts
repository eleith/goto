import { loadConfig } from '@goto/config';
import type { GenericOAuthOptions } from 'better-auth/plugins/generic-oauth';
import { assert, expect, test } from 'vitest';
import { buildAuthOptions, verifyCredentials } from './providers.js';

const credentials = { username: 'local-admin', password: 'test-only-password' };

test('recognizes the configured shared identity without returning its password', () => {
	expect(verifyCredentials(credentials, credentials)).toEqual({ id: 'admin', name: 'local-admin' });
});

test.each([
	null,
	{ username: 'different', password: credentials.password },
	{ username: credentials.username, password: 'different' },
	{ username: credentials.username, password: null }
])('rejects invalid submitted credentials', (submitted) => {
	expect(verifyCredentials(credentials, submitted)).toBeNull();
});

test('requires an ID token before accepting an OIDC account subject', () => {
	const { configuration } = loadConfig(
		{
			url: { app: 'https://goto.example.test' },
			auth: {
				oidc: {
					issuer: 'https://identity.example.test',
					client_id: 'goto-test',
					client_secret: 'test-only-secret'
				}
			},
			domains: {}
		},
		{ env: {} }
	);
	const { plugins } = buildAuthOptions(configuration);
	const oauth = plugins?.find((plugin) => plugin.id === 'generic-oauth');
	const options = oauth?.options as GenericOAuthOptions | undefined;
	const provider = options?.config[0];
	const accountSubject = provider?.accountSubject;
	assert(accountSubject);
	expect(provider?.requireIdTokenVerification).toBe(true);
	const profile = { sub: 'provider-subject', emailVerified: true };
	expect(() => accountSubject({ tokens: {}, profile })).toThrow(
		'OIDC sign-in requires an ID token'
	);
	expect(accountSubject({ tokens: { idToken: 'already-verified' }, profile })).toBe(profile.sub);
});
