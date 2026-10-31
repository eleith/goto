import { ConfigError, loadConfigFile, validateConfig } from '@goto/config';
import type { Handle } from '@sveltejs/kit/hooks';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { adminOriginGate, init, securityHeaders } from './hooks.server.js';

const framework = vi.hoisted(() => ({ building: false }));
vi.mock('$app/env', () => framework);
vi.mock('@goto/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@goto/config')>()),
	loadConfigFile: vi.fn()
}));

const event = {
	request: new Request('http://localhost/healthz'),
	url: new URL('http://localhost/healthz'),
	route: { id: '/healthz' }
} as Parameters<Handle>[0]['event'];

test('adds security headers without changing the application response', async () => {
	const original = new Response('ready', {
		status: 202,
		statusText: 'Accepted',
		headers: { 'cache-control': 'no-store' }
	});

	const response = await securityHeaders({
		event,
		resolve: async (received) => {
			expect(received.url.href).toBe(event.url.href);
			expect(received.request.method).toBe(event.request.method);
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
	const response = await securityHeaders({
		event,
		resolve: async () => Response.redirect(target, 302)
	});

	expect(response.status).toBe(302);
	expect(response.headers.get('location')).toBe(target);
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});

test('preserves separate cookie headers', async () => {
	const original = new Response(null);
	original.headers.append('set-cookie', 'first=one; Path=/; HttpOnly');
	original.headers.append('set-cookie', 'second=two; Path=/; HttpOnly');

	const response = await securityHeaders({ event, resolve: async () => original });

	expect(response.headers.getSetCookie()).toEqual(original.headers.getSetCookie());
});

describe('admin group origin', () => {
	const adminEvent = (url: string, routeId: string) =>
		({
			...event,
			request: new Request(url),
			url: new URL(url),
			route: { id: routeId }
		}) as Parameters<Handle>[0]['event'];

	beforeEach(async () => {
		framework.building = false;
		vi.mocked(loadConfigFile).mockResolvedValue(
			validateConfig(
				{
					site: { url: 'https://admin.example.org' },
					auth: { credentials: { username: 'example', password: 'test-password' } },
					domains: { 'go.example.org': { links: {} } }
				},
				{ env: {} }
			)
		);
		await init();
	});

	test.each([
		['/(admin)/(public)/schema.json', '/schema.json'],
		['/(admin)/(auth)/admin', '/admin']
	])('allows %s on the configured admin origin', async (routeId, path) => {
		const resolve = vi.fn(async () => new Response('admin response'));
		const response = await adminOriginGate({
			event: adminEvent(`https://admin.example.org${path}`, routeId),
			resolve
		});

		expect(resolve).toHaveBeenCalledOnce();
		expect(await response.text()).toBe('admin response');
	});

	test.each([
		['/(admin)/(public)/schema.json', 'https://go.example.org/%73chema.json'],
		['/(admin)/(auth)/admin', 'https://go.example.org/admin'],
		['/(admin)/(public)/schema.json', 'http://admin.example.org/schema.json']
	])('blocks %s on another origin: %s', async (routeId, url) => {
		const resolve = vi.fn(async () => new Response('admin response'));
		const response = await adminOriginGate({
			event: adminEvent(url, routeId),
			resolve
		});

		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(resolve).not.toHaveBeenCalled();
	});

	test('adds security headers when the admin gate rejects a request', async () => {
		const resolve = vi.fn(async () => new Response('admin response'));
		const response = await securityHeaders({
			event: adminEvent('https://go.example.org/schema.json', '/(admin)/(public)/schema.json'),
			resolve: async (event) => adminOriginGate({ event, resolve })
		});

		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(resolve).not.toHaveBeenCalled();
	});

	test('leaves health outside the admin origin gate', async () => {
		const resolve = vi.fn(async () => new Response('ready'));

		const response = await adminOriginGate({ event, resolve });

		expect(resolve).toHaveBeenCalledOnce();
		expect(await response.text()).toBe('ready');
	});

	test('does not load deployment configuration while building', async () => {
		vi.mocked(loadConfigFile).mockClear();
		framework.building = true;

		await init();

		expect(loadConfigFile).not.toHaveBeenCalled();
	});

	test('does not suppress startup validation failures', async () => {
		vi.mocked(loadConfigFile).mockRejectedValue(new ConfigError());

		await expect(init()).rejects.toThrow('Invalid configuration');
	});
});
