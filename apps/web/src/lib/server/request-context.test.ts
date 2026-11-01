import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { validateConfig } from '@goto/config';
import { describe, expect, test } from 'vitest';
import type { Application } from './application.js';
import { bindApplication, requestApplication, requestOrigin } from './request-context.js';

function application(): Application {
	return validateConfig(
		{
			site: { url: 'https://admin.example.org' },
			auth: { credentials: { username: 'example', password: 'test-password' } },
			domains: {}
		},
		{ env: {} }
	);
}

function request(kind: 'web' | 'node'): Request | IncomingMessage {
	return kind === 'web'
		? new Request('https://admin.example.org/schema.json')
		: new IncomingMessage(new Socket());
}

describe.each(['web', 'node'] as const)('%s request application', (kind) => {
	test('keeps captured references isolated between requests', () => {
		const first = request(kind);
		const second = request(kind);
		const firstApplication = application();
		const secondApplication = application();

		expect(requestApplication(first)).toBeUndefined();
		expect(requestApplication(second)).toBeUndefined();
		bindApplication(first, firstApplication);

		expect(requestApplication(first) === firstApplication).toBe(true);
		expect(requestApplication(second)).toBeUndefined();
		bindApplication(second, secondApplication);

		expect(requestApplication(first) === firstApplication).toBe(true);
		expect(requestApplication(second) === secondApplication).toBe(true);
	});

	test('does not include the application in enumerable request properties', () => {
		const current = request(kind);
		const keys = Reflect.ownKeys({ ...current });
		const captured = application();

		bindApplication(current, captured);

		expect(Reflect.ownKeys({ ...current })).toEqual(keys);
		expect(requestApplication(current) === captured).toBe(true);
	});

	test('does not accept application context supplied through headers', () => {
		const current = request(kind);
		const headers = {
			'goto.request.application': 'injected',
			'x-goto-application': 'injected'
		};
		if (current instanceof Request) {
			for (const [name, value] of Object.entries(headers)) current.headers.set(name, value);
		} else {
			current.headers = headers;
		}

		expect(requestApplication(current)).toBeUndefined();
	});
});

test('bridges the same captured reference from a Node request to a Web Request', () => {
	const incoming = new IncomingMessage(new Socket());
	const web = new Request('https://admin.example.org/schema.json');
	const captured = application();
	bindApplication(incoming, captured);
	const bridged = requestApplication(incoming);
	if (!bridged) throw new Error('Expected a captured application');

	bindApplication(web, bridged);

	expect(requestApplication(incoming) === captured).toBe(true);
	expect(requestApplication(web) === captured).toBe(true);
});

test('carries the trusted request origin separately from the configured admin origin', () => {
	const incoming = new IncomingMessage(new Socket());
	const captured = application();

	bindApplication(incoming, captured, 'http://localhost:5173');

	expect(requestOrigin(incoming)).toBe('http://localhost:5173');
	expect(requestApplication(incoming)?.configuration.site.url).toBe('https://admin.example.org');
});

test('binding neither consumes the request body nor serializes private configuration', async () => {
	const current = new Request('https://admin.example.org/auth/sign-in/credentials', {
		method: 'POST',
		body: 'submitted-form'
	});
	const captured = application();

	bindApplication(current, captured);
	requestApplication(current);

	expect(current.bodyUsed).toBe(false);
	expect(JSON.stringify(current).includes('test-password')).toBe(false);
	expect(await current.text()).toBe('submitted-form');
});
