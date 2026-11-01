import { validateConfig } from '@goto/config';
import type { IncomingMessage } from 'node:http';
import { expect, test } from 'vitest';
import type { Application } from './application.js';
import { handleIngress } from './dispatch.js';
import { requestApplication } from './request-context.js';

const application: Application = validateConfig(
	{
		site: { url: 'https://admin.example.test' },
		auth: { credentials: { username: 'example', password: 'unit-only-password' } },
		domains: {
			'go.example.test': {
				links: {
					'/schema.json': { url: 'https://destination.example.test/schema' },
					'/_app/version.json': { url: 'https://destination.example.test/asset' }
				}
			},
			'localhost:3000': {
				links: { '/healthz': { url: 'https://destination.example.test/health' } }
			}
		}
	},
	{ env: {} }
);

function request(host: string, url = '/schema.json', remoteAddress = '127.0.0.1') {
	return {
		headers: { host },
		rawHeaders: ['Host', host],
		url,
		method: 'GET',
		socket: { remoteAddress }
	} as IncomingMessage;
}

test('only canonical admin requests reach the whole adapter with captured application context', () => {
	const incoming = request('admin.example.test', '/_app/version.json');

	expect(handleIngress(application, incoming, {})).toBeUndefined();
	expect(requestApplication(incoming)).toBe(application);
});

test.each([
	['/schema.json', 'schema'],
	['/_app/version.json', 'asset']
])('public %s is handled before admin endpoints and assets', (path, destination) => {
	const incoming = request('go.example.test', path);
	const response = handleIngress(application, incoming, {});

	expect(response?.status).toBe(302);
	expect(response?.headers.get('location')).toBe(`https://destination.example.test/${destination}`);
	expect(requestApplication(incoming)).toBeUndefined();
});

test('a known public host retains its health path even for a loopback connection', () => {
	const incoming = request('localhost:3000', '/healthz');
	const response = handleIngress(application, incoming, {});

	expect(response?.status).toBe(302);
	expect(response?.headers.get('location')).toBe('https://destination.example.test/health');
});

test('allows an actual internal probe without enrolling arbitrary hosts', () => {
	const response = handleIngress(application, request('localhost:3001', '/healthz'), {});

	expect(response?.status).toBe(200);
	expect(response?.headers.get('cache-control')).toBe('no-store');
	expect(
		handleIngress(application, request('localhost:3001', '/healthz', '192.0.2.1'), {})?.status
	).toBe(404);
});

test('rejects unknown hosts before the adapter instead of borrowing a fallback', () => {
	const incoming = request('unknown.example.test', '/_app/version.json');

	expect(handleIngress(application, incoming, {})?.status).toBe(404);
	expect(requestApplication(incoming)).toBeUndefined();
});

test('rejects another origin on the admin authority before serving static assets', () => {
	const incoming = request('admin.example.test', '/_app/version.json');

	expect(handleIngress(application, incoming, {}, 'http')?.status).toBe(404);
});

test('does not trust forwarded authority unless explicitly configured', () => {
	const incoming = request('go.example.test');
	incoming.headers['x-forwarded-host'] = 'admin.example.test';

	expect(handleIngress(application, incoming, {})?.status).toBe(302);
});

test('rejects malformed ingress without reaching either handler', () => {
	const incoming = request('admin.example.test/other');

	expect(handleIngress(application, incoming, {})?.status).toBe(400);
	expect(requestApplication(incoming)).toBeUndefined();
});
