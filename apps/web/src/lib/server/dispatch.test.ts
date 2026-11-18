import { loadConfig } from '@goto/config';
import type { IncomingMessage } from 'node:http';
import { expect, test, vi } from 'vitest';
import type { Application } from './application.js';
import { handleIngress } from './dispatch.js';
import { requestApplication } from './request-context.js';
import { prepareSnapshot } from './snapshot.js';

const prepared = loadConfig(
	{
		url: { app: 'https://admin.example.test' },
		auth: { credentials: { username: 'example', password: 'unit-only-password' } },
		domains: {
			'go.example.test': {
				links: {
					'/schema.json': {
						url: 'https://destination.example.test/schema',
						redirect: [
							{
								if: { language: 'fr', os: 'ios' },
								to: 'https://destination.example.test/french-ios-schema'
							}
						]
					},
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
const application: Application = { currentSnapshot: () => snapshot, linkVisitCount: () => 0 };

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

test('captures one canonical visit and original request headers for a conditional redirect using the trusted IP', () => {
	const recordVisit = vi.fn();
	const tracked = { ...application, recordVisit };
	const incoming = request('go.example.test', '/%73chema.json?private=not-collected');
	Object.assign(incoming.headers, {
		'x-real-ip': '2001:db8::1',
		'user-agent': 'Example agent (iPhone)',
		'accept-language': 'fr-CA,en;q=0.9',
		cookie: 'private-cookie',
		referer: 'https://private.example.test/'
	});

	const response = handleIngress(tracked, incoming, {});
	expect(response?.status).toBe(302);
	expect(response?.headers.get('location')).toBe(
		'https://destination.example.test/french-ios-schema'
	);
	expect(response?.headers.get('vary')).toBe('Accept-Language, User-Agent');
	expect(recordVisit).toHaveBeenCalledExactlyOnceWith({
		domain: 'go.example.test',
		path: '/schema.json',
		outcome: 'valid',
		visited_at: expect.any(Number),
		ip: '2001:db8::1',
		user_agent: 'Example agent (iPhone)',
		accept_language: 'fr-CA,en;q=0.9'
	});
});

test('array-valued request headers neither select a conditional destination nor enter raw capture', () => {
	const recordVisit = vi.fn();
	const tracked = { ...application, recordVisit };
	const incoming = request('go.example.test');
	Object.assign(incoming.headers, {
		'accept-language': ['fr'],
		'user-agent': ['iPhone']
	});

	const response = handleIngress(tracked, incoming, {});
	expect(response?.headers.get('location')).toBe('https://destination.example.test/schema');
	expect(recordVisit).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ user_agent: null, accept_language: null })
	);
});

test('captures invalid decoded paths even when the fallback redirects', () => {
	const recordVisit = vi.fn();
	const fallbackSnapshot = {
		...snapshot,
		domains: {
			...snapshot.domains,
			'go.example.test': {
				...snapshot.domains['go.example.test']!,
				fallback: {
					url: 'https://fallback.example.test/',
					status_code: 302 as const,
					forward_query: false
				}
			}
		}
	};
	const tracked = { ...application, currentSnapshot: () => fallbackSnapshot, recordVisit };
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

test('does not record HEAD, malformed, admin or unknown-host requests', () => {
	const recordVisit = vi.fn();
	const tracked = { ...application, recordVisit };
	const head = request('go.example.test');
	head.method = 'HEAD';
	head.headers['accept-language'] = 'fr-CA,en;q=0.9';
	head.headers['user-agent'] = 'Example agent (iPhone)';
	const headResponse = handleIngress(tracked, head, {});
	expect(headResponse?.status).toBe(302);
	expect(headResponse?.headers.get('location')).toBe(
		'https://destination.example.test/french-ios-schema'
	);
	expect(handleIngress(tracked, request('go.example.test', '/%'), {})?.status).toBe(400);
	expect(handleIngress(tracked, request('unknown.example.test'), {})?.status).toBe(404);
	expect(handleIngress(tracked, request('admin.example.test'), {})).toBeUndefined();
	expect(recordVisit).not.toHaveBeenCalled();
});

test('zero retention captures only identity, outcome and time without changing conditional routing', () => {
	const recordVisit = vi.fn();
	const minimal = {
		...snapshot,
		configuration: {
			...snapshot.configuration,
			analytics: { ...snapshot.configuration.analytics, retention_months: 0 as const }
		}
	};
	const tracked = { ...application, currentSnapshot: () => minimal, recordVisit };
	const incoming = request('go.example.test');
	Object.assign(incoming.headers, {
		'x-real-ip': '2001:db8::1',
		'user-agent': 'Example agent (iPhone)',
		'accept-language': 'fr-CA,en;q=0.9'
	});
	expect(handleIngress(tracked, incoming, {})?.headers.get('location')).toBe(
		'https://destination.example.test/french-ios-schema'
	);
	expect(handleIngress(tracked, request('go.example.test', '/missing'), {})?.status).toBe(404);
	expect(recordVisit.mock.calls).toEqual([
		[
			{
				domain: 'go.example.test',
				path: '/schema.json',
				outcome: 'valid',
				visited_at: expect.any(Number),
				ip: null,
				user_agent: null,
				accept_language: null
			}
		],
		[
			{
				domain: 'go.example.test',
				path: '/missing',
				outcome: 'invalid',
				visited_at: expect.any(Number),
				ip: null,
				user_agent: null,
				accept_language: null
			}
		]
	]);
});

test('invalid client addresses and capture failures cannot prevent redirects', () => {
	const recordVisit = vi.fn(() => {
		throw new Error('private-writer-detail');
	});
	const tracked = { ...application, recordVisit };
	const malformed = request('go.example.test');
	malformed.headers['x-real-ip'] = 'not-an-address';
	expect(handleIngress(tracked, malformed, {})?.status).toBe(302);
	expect(recordVisit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ip: null }));
	recordVisit.mockClear();
	const direct = request('go.example.test');
	direct.headers['x-forwarded-for'] = '203.0.113.1';
	expect(handleIngress(tracked, direct, {})?.status).toBe(302);
	expect(recordVisit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ip: '127.0.0.1' }));
});
