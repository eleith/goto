import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { loadConfig } from '@goto/config';
import type { Handle } from '@sveltejs/kit/hooks';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Application } from '#lib/server/application.js';
import { bindApplication } from '#lib/server/request-context.js';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { adminOriginGate, applicationContext, securityHeaders } from './hooks.server.js';

const framework = vi.hoisted(() => ({ building: false }));
vi.mock('$app/env', () => framework);

type RequestEvent = Parameters<Handle>[0]['event'];

function event(
	url = 'http://localhost/healthz',
	routeId: string | null = '/healthz',
	incoming?: IncomingMessage
): RequestEvent {
	return {
		request: new Request(url),
		url: new URL(url),
		route: { id: routeId },
		locals: {},
		...(incoming ? { platform: { req: incoming } } : {})
	} as RequestEvent;
}

function application(): Application {
	const prepared = loadConfig(
		{
			url: { app: 'https://admin.example.org' },
			auth: { credentials: { username: 'example', password: 'test-password' } },
			domains: { 'go.example.org': { links: {} } }
		},
		{ env: {} }
	);
	const snapshot = prepareSnapshot(prepared);
	return { currentSnapshot: () => snapshot, linkVisitCount: () => 0 };
}

beforeEach(() => {
	framework.building = false;
});

describe('security headers', () => {
	test('adds headers without changing the application response', async () => {
		const current = event();
		const original = new Response('ready', {
			status: 202,
			statusText: 'Accepted',
			headers: { 'cache-control': 'no-store' }
		});

		const response = await securityHeaders({
			event: current,
			resolve: async (received) => {
				expect(received.url.href).toBe(current.url.href);
				expect(received.request.method).toBe(current.request.method);
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
			event: event(),
			resolve: async () => Response.redirect(target, 302)
		});

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(target);
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});

	test('preserves separate cookie headers', async () => {
		const cookies = ['first=one; Path=/; HttpOnly', 'second=two; Path=/; HttpOnly'];
		const original = new Response(null);
		for (const cookie of cookies) original.headers.append('set-cookie', cookie);

		const response = await securityHeaders({ event: event(), resolve: async () => original });

		expect(response.headers.getSetCookie()).toEqual(cookies);
	});
});

describe('application context', () => {
	test('uses the application captured on the development Web Request', async () => {
		const current = event();
		const captured = application();
		bindApplication(current.request, captured);
		const resolve = vi.fn(async (received: RequestEvent) => {
			expect(received.locals.application === captured).toBe(true);
			return new Response('ready');
		});

		const response = await applicationContext({ event: current, resolve });

		expect(resolve).toHaveBeenCalledOnce();
		expect(await response.text()).toBe('ready');
	});

	test('uses the application captured on the production IncomingMessage', async () => {
		const incoming = new IncomingMessage(new Socket());
		const captured = application();
		bindApplication(incoming, captured);
		const current = event(
			'https://admin.example.org/schema.json',
			'/(admin)/(public)/schema.json',
			incoming
		);
		const resolve = vi.fn(async (received: RequestEvent) => {
			expect(received.locals.application === captured).toBe(true);
			return new Response('schema');
		});

		await applicationContext({ event: current, resolve });

		expect(resolve).toHaveBeenCalledOnce();
	});

	test('uses the development platform application for framework-created subrequests', async () => {
		const captured = application();
		const current = { ...event(), platform: { application: captured } as App.Platform };
		const resolve = vi.fn(async (received: RequestEvent) => {
			expect(received.locals.application).toBe(captured);
			return new Response('subrequest');
		});

		await applicationContext({ event: current, resolve });

		expect(resolve).toHaveBeenCalledOnce();
	});

	test('rejects a missing capture before resolving, with security headers', async () => {
		const current = event();
		const resolve = vi.fn(async () => new Response('must not resolve'));
		const response = await securityHeaders({
			event: current,
			resolve: async (event) => applicationContext({ event, resolve })
		});

		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(resolve).not.toHaveBeenCalled();
		expect(current.locals.application).toBeUndefined();
	});

	test('skips request application lookup while building', async () => {
		framework.building = true;
		const current = event();
		const resolve = vi.fn(async () => new Response('prerendered'));

		const response = await applicationContext({ event: current, resolve });

		expect(resolve).toHaveBeenCalledOnce();
		expect(current.locals.application).toBeUndefined();
		expect(await response.text()).toBe('prerendered');
	});
});

describe('admin group origin', () => {
	test.each([
		['/(admin)/(public)/schema.json', '/schema.json'],
		['/(admin)/(auth)/admin', '/admin']
	])('allows %s on the configured admin origin', async (routeId, path) => {
		const current = event(`https://admin.example.org${path}`, routeId);
		current.locals.application = application();
		current.locals.snapshot = current.locals.application.currentSnapshot();
		const resolve = vi.fn(async () => new Response('admin response'));

		const response = await adminOriginGate({ event: current, resolve });

		expect(resolve).toHaveBeenCalledOnce();
		expect(await response.text()).toBe('admin response');
	});

	test.each([
		['/(admin)/(public)/schema.json', 'https://go.example.org/%73chema.json'],
		['/(admin)/(auth)/admin', 'https://go.example.org/admin'],
		['/(admin)/(public)/schema.json', 'http://admin.example.org/schema.json'],
		['/(admin)/(auth)/admin', 'https://admin.example.org:8443/admin']
	])('blocks %s on another native origin: %s', async (routeId, url) => {
		const current = event(url, routeId);
		current.locals.application = application();
		current.locals.snapshot = current.locals.application.currentSnapshot();
		const resolve = vi.fn(async () => new Response('admin response'));

		const response = await adminOriginGate({ event: current, resolve });

		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.text()).toBe('Not found');
		expect(resolve).not.toHaveBeenCalled();
	});

	test('does not admit an admin route without an application in locals', async () => {
		const resolve = vi.fn(async () => new Response('admin response'));

		const response = await adminOriginGate({
			event: event('https://admin.example.org/schema.json', '/(admin)/(public)/schema.json'),
			resolve
		});

		expect(response.status).toBe(404);
		expect(resolve).not.toHaveBeenCalled();
	});

	test('adds security headers when the captured application rejects an admin origin', async () => {
		const current = event('https://go.example.org/schema.json', '/(admin)/(public)/schema.json');
		bindApplication(current.request, application());
		const resolve = vi.fn(async () => new Response('admin response'));

		const response = await securityHeaders({
			event: current,
			resolve: async (event) =>
				applicationContext({
					event,
					resolve: async (event) => adminOriginGate({ event, resolve })
				})
		});

		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(resolve).not.toHaveBeenCalled();
	});

	test('leaves health outside the admin origin gate', async () => {
		const current = event();
		current.locals.application = application();
		current.locals.snapshot = current.locals.application.currentSnapshot();
		const resolve = vi.fn(async () => new Response('ready'));

		const response = await adminOriginGate({ event: current, resolve });

		expect(resolve).toHaveBeenCalledOnce();
		expect(await response.text()).toBe('ready');
	});
});
