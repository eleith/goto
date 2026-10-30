import type { Handle } from '@sveltejs/kit/hooks';
import { expect, test } from 'vitest';
import { handle } from './hooks.server.js';

const event = {
	request: new Request('http://localhost/healthz'),
	url: new URL('http://localhost/healthz')
} as Parameters<Handle>[0]['event'];

test('adds security headers without changing the application response', async () => {
	const original = new Response('ready', {
		status: 202,
		statusText: 'Accepted',
		headers: { 'cache-control': 'no-store' }
	});

	const response = await handle({
		event,
		resolve: async (received) => {
			expect(received).toBe(event);
			return original;
		}
	});

	expect(response.status).toBe(202);
	expect(response.statusText).toBe('Accepted');
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
	expect(original.headers.has('x-content-type-options')).toBe(false);
	expect(await response.text()).toBe('ready');
});

test('handles immutable redirect headers without changing the target', async () => {
	const target = 'https://example.org/documentation';
	const response = await handle({ event, resolve: async () => Response.redirect(target, 302) });

	expect(response.status).toBe(302);
	expect(response.headers.get('location')).toBe(target);
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});

test('preserves separate cookie headers', async () => {
	const original = new Response(null);
	original.headers.append('set-cookie', 'first=one; Path=/; HttpOnly');
	original.headers.append('set-cookie', 'second=two; Path=/; HttpOnly');

	const response = await handle({ event, resolve: async () => original });

	expect(response.headers.getSetCookie()).toEqual(original.headers.getSetCookie());
});
