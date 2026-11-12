import { validateConfig } from '@goto/config';
import type { IncomingMessage } from 'node:http';
import { expect, test, vi } from 'vitest';
import type { Application } from './application.js';
import { handleIngress } from './dispatch.js';
import { requestApplication } from './request-context.js';
import { prepareSnapshot } from './snapshot.js';

const prepared = validateConfig(
	{
		url: { app: 'https://admin.example.test' },
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
const snapshot = prepareSnapshot(prepared);
const application: Application = { currentSnapshot: () => snapshot };

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

test('captures the request outcome, logical path and raw fields using the trusted IP header', () => {
	const recordVisit = vi.fn();
	const tracked = { ...application, recordVisit };
	const incoming = request('go.example.test', '/%73chema.json?private=not-collected');
	Object.assign(incoming.headers, {
		'x-real-ip': '2001:db8::1',
		'user-agent': 'Example agent',
		'accept-language': 'en-US,en;q=0.9',
		cookie: 'private-cookie',
		referer: 'https://private.example.test/'
	});

	expect(handleIngress(tracked, incoming, {})?.status).toBe(302);
	expect(recordVisit).toHaveBeenCalledExactlyOnceWith({
		domain: 'go.example.test',
		path: '/schema.json',
		outcome: 'valid',
		visited_at: expect.any(Number),
		ip: '2001:db8::1',
		user_agent: 'Example agent',
		accept_language: 'en-US,en;q=0.9'
	});
});

test('captures invalid decoded paths even when the fallback redirects', () => {
	const recordVisit = vi.fn();
	const fallbackSnapshot = {
		...snapshot,
		domains: {
			...snapshot.domains,
			'go.example.test': {
				...snapshot.domains['go.example.test']!,
				fallback: 'https://fallback.example.test/'
			}
		}
	};
	const tracked = { currentSnapshot: () => fallbackSnapshot, recordVisit };
	const incoming = request('go.example.test', '/%6dissing?private=not-collected');
	expect(handleIngress(tracked, incoming, {})?.status).toBe(302);
	expect(recordVisit).toHaveBeenCalledExactlyOnceWith({
		domain: 'go.example.test',
		path: '/missing',
		outcome: 'invalid',
		visited_at: expect.any(Number),
		ip: '127.0.0.1',
		user_agent: null,
		accept_language: null
	});
});

test('does not record HEAD, malformed, admin, unknown-host or disabled-analytics requests', () => {
	const recordVisit = vi.fn();
	const tracked = { ...application, recordVisit };
	const head = request('go.example.test');
	head.method = 'HEAD';
	expect(handleIngress(tracked, head, {})?.status).toBe(302);
	expect(handleIngress(tracked, request('go.example.test', '/%'), {})?.status).toBe(400);
	expect(handleIngress(tracked, request('unknown.example.test'), {})?.status).toBe(404);
	expect(handleIngress(tracked, request('admin.example.test'), {})).toBeUndefined();
	const disabled = {
		...snapshot,
		configuration: {
			...snapshot.configuration,
			analytics: { ...snapshot.configuration.analytics, retention_months: 0 as const }
		}
	};
	expect(
		handleIngress({ currentSnapshot: () => disabled, recordVisit }, request('go.example.test'), {})
			?.status
	).toBe(302);
	expect(
		handleIngress(
			{ currentSnapshot: () => disabled, recordVisit },
			request('go.example.test', '/missing'),
			{}
		)?.status
	).toBe(404);
	expect(recordVisit).not.toHaveBeenCalled();
});

test('invalid client addresses and capture failures cannot prevent redirects', () => {
	const recordVisit = vi.fn(() => {
		throw new Error('private-writer-detail');
	});
	const tracked = { ...application, recordVisit };
	const malformed = request('go.example.test');
	malformed.headers['x-real-ip'] = 'not-an-address';
	expect(handleIngress(tracked, malformed, {})?.status).toBe(302);
	expect(recordVisit).not.toHaveBeenCalled();
	const direct = request('go.example.test');
	direct.headers['x-forwarded-for'] = '203.0.113.1';
	expect(handleIngress(tracked, direct, {})?.status).toBe(302);
	expect(recordVisit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ip: '127.0.0.1' }));
});
