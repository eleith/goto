import { expect, test } from 'vitest';
import { verifyCredentials } from './providers.js';

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
