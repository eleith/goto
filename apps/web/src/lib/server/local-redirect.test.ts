import { expect, test } from 'vitest';
import { localRedirect } from './local-redirect.js';

const origin = 'https://admin.example.test';

test('retains local return paths and their query', () => {
	expect(localRedirect('/admin?domain=go.example.test', origin, '/admin')).toBe(
		'/admin?domain=go.example.test'
	);
});

test.each([
	'https://other.example.test/admin',
	'//other.example.test/admin',
	'javascript:alert(1)'
])('rejects an external return URL', (value) => {
	expect(localRedirect(value, origin, '/admin')).toBe('/admin');
});
