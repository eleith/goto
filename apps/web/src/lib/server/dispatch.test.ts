import { loadConfig } from '@goto/config';
import type { IncomingMessage } from 'node:http';
import { expect, test, vi } from 'vitest';
import type { Application } from './application.js';
import { adminCacheControl, handleIngress } from './dispatch.js';
import { requestApplication, requestContext } from './request-context.js';
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
					'/_app/version.json': { url: 'https://destination.example.test/asset' },
					'/%40static/og.png': { url: 'https://destination.example.test/literal-percent' },
					'/@static': { url: 'https://go.example.test/@static/og.png', forward_path: true }
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

test('canonical admin requests reach the adapter with captured application context', () => {
	const incoming = request('admin.example.test', '/_app/version.json');

	expect(handleIngress(application, incoming, {})).toBeUndefined();
	expect(requestApplication(incoming)).toBe(application);
	expect(requestContext(incoming)).toMatchObject({
		origin: 'https://admin.example.test',
		snapshot
	});
});

test('reserved paths on a shared host bypass redirects and visit capture', () => {
	const shared = prepareSnapshot(
		loadConfig(
			{
				url: { app: 'https://go.example.test' },
				auth: { credentials: { username: 'example', password: 'unit-only-password' } },
				domains: {
					'go.example.test': {
						links: {
							'/src': { url: 'https://go.example.test/src/lib/docs', forward_path: true }
						},
						root: { url: 'https://go.example.test/admin' },
						fallback: { url: 'https://destination.example.test/fallback' }
					}
				}
			},
			{ env: {} }
		)
	);
	const recordVisit = vi.fn();
	const tracked = { ...application, currentSnapshot: () => shared, recordVisit };
	const normalizedAdmin = request('go.example.test', '/docs/../%61dmin/');
	expect(handleIngress(tracked, normalizedAdmin, {})).toBeUndefined();
	expect(requestContext(normalizedAdmin)?.snapshot).toBe(shared);
	expect(adminCacheControl(normalizedAdmin)).toBe('private, no-store');
	expect(handleIngress(tracked, request('go.example.test', '/admin'), {}, 'http')?.status).toBe(
		404
	);

	const signIn = request('go.example.test', '/auth/sign-in/credentials');
	signIn.method = 'POST';
	expect(handleIngress(tracked, signIn, {})).toBeUndefined();
	expect(requestContext(signIn)?.snapshot).toBe(shared);

	const rawReservedModule = request('go.example.test', '/src%2Flib/../guide');
	expect(handleIngress(tracked, rawReservedModule, {})).toBeUndefined();
	expect(requestContext(rawReservedModule)?.snapshot).toBe(shared);

	const serveAsset = vi.fn();
	const asset = request('go.example.test', '/@static/favicon.svg');
	expect(handleIngress(tracked, asset, {}, 'https', serveAsset)).toBeUndefined();
	expect(requestContext(asset)?.snapshot).toBe(shared);
	expect(serveAsset).not.toHaveBeenCalled();
	expect(recordVisit).not.toHaveBeenCalled();

	const link = handleIngress(tracked, request('go.example.test', '/src/guide'), {});
	expect(link?.headers.get('location')).toBe('https://go.example.test/src/lib/docs/guide');
	expect(recordVisit).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ domain: 'go.example.test', path: '/src', outcome: 'valid' })
	);

	const root = handleIngress(tracked, request('go.example.test', '/'), {});
	expect(root?.headers.get('location')).toBe('https://go.example.test/admin');
});

test('a redirect host with an explicit default port takes priority over the app origin', () => {
	const overlap = prepareSnapshot(
		loadConfig(
			{
				url: { app: 'http://admin.example.test' },
				auth: { credentials: { username: 'example', password: 'unit-only-password' } },
				domains: {
					'admin.example.test:80': {
						links: { '/schema.json': { url: 'https://destination.example.test/schema' } }
					}
				}
			},
			{ env: {} }
		)
	);
	const recordVisit = vi.fn();
	const tracked = { ...application, currentSnapshot: () => overlap, recordVisit };
	const incoming = request('admin.example.test:80');
	const response = handleIngress(tracked, incoming, {}, 'http');

	expect(response?.status).toBe(302);
	expect(response?.headers.get('location')).toBe('https://destination.example.test/schema');
	expect(requestContext(incoming)).toBeUndefined();
	expect(recordVisit).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ domain: 'admin.example.test:80', path: '/schema.json' })
	);
});

test('reserved assets bypass prefix redirects, fallback, and visit capture', () => {
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

	for (const method of ['GET', 'HEAD']) {
		const incoming = request('go.example.test', '/@static/og.png?version=1');
		incoming.method = method;

		expect(handleIngress(tracked, incoming, {})).toBeUndefined();
		const context = requestContext(incoming);
		expect(context?.application).toBe(tracked);
		expect(context?.snapshot).toBe(fallbackSnapshot);
		expect(context?.origin).toBe('https://go.example.test');
	}
	const missing = request('go.example.test', '/%40static/missing.svg');
	expect(handleIngress(tracked, missing, {})?.status).toBe(404);
	expect(requestContext(missing)).toBeUndefined();
	expect(recordVisit).not.toHaveBeenCalled();
});

test('ingress uses the development asset reader only on the redirect host', async () => {
	const recordVisit = vi.fn();
	const tracked = { ...application, recordVisit };
	const assetResponse = new Response('asset contents');
	const serveAsset = vi.fn(async () => assetResponse);
	const incoming = request('go.example.test', '/@static/og.svg?raw');

	const response = await handleIngress(tracked, incoming, {}, 'http', serveAsset);

	expect(response).toBe(assetResponse);
	expect(serveAsset).toHaveBeenCalledExactlyOnceWith('/@static/og.svg', 'GET');
	expect(requestContext(incoming)).toBeUndefined();
	expect(recordVisit).not.toHaveBeenCalled();

	const appRequest = request('admin.example.test', '/@static/og.svg');
	expect(handleIngress(tracked, appRequest, {}, 'https', serveAsset)).toBeUndefined();
	expect(requestApplication(appRequest)).toBe(tracked);
	expect(serveAsset).toHaveBeenCalledOnce();
});

test('site asset URLs do not bypass public method restrictions', () => {
	const recordVisit = vi.fn();
	const incoming = request('go.example.test', '/@static/favicon.svg');
	incoming.method = 'POST';
	const response = handleIngress({ ...application, recordVisit }, incoming, {});

	expect(response?.status).toBe(405);
	expect(response?.headers.get('allow')).toBe('GET, HEAD');
	expect(requestContext(incoming)).toBeUndefined();
	expect(recordVisit).not.toHaveBeenCalled();
});

test('other public resource paths stay outside the adapter', async () => {
	for (const path of ['/signin', '/_app/unclaimed.js']) {
		const incoming = request('go.example.test', path);
		const response = handleIngress(application, incoming, {});

		expect(response?.status).toBe(404);
		expect(await response?.text()).toContain('<title>Not found — Goto</title>');
		expect(requestContext(incoming)).toBeUndefined();
	}
});

test('the bare /@static forwarding link can redirect to a same-host asset', () => {
	const incoming = request('go.example.test', '/%40static');
	const response = handleIngress(application, incoming, {});

	expect(response?.status).toBe(302);
	expect(response?.headers.get('location')).toBe('https://go.example.test/@static/og.png');
	expect(requestContext(incoming)).toBeUndefined();
});

test('literal-percent link keys keep single-decode routing instead of becoming asset requests', () => {
	const incoming = request('go.example.test', '/%2540static/og.png');
	const response = handleIngress(application, incoming, {});

	expect(response?.status).toBe(302);
	expect(response?.headers.get('location')).toBe(
		'https://destination.example.test/literal-percent'
	);
	expect(requestContext(incoming)).toBeUndefined();

	const recordVisit = vi.fn();
	const encodedAsset = request('go.example.test', '/%40static/og.png?v=1');
	const assetResponse = handleIngress({ ...application, recordVisit }, encodedAsset, {});
	expect(assetResponse?.status).toBe(308);
	expect(assetResponse?.headers.get('location')).toBe('/@static/og.png?v=1');
	expect(recordVisit).not.toHaveBeenCalled();
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

test.each([
	['unknown authority', 'unknown.example.test', 'https'],
	['wrong scheme on the admin authority', 'admin.example.test', 'http']
] as const)('rejects an asset on %s before serving it', async (_scenario, host, scheme) => {
	const recordVisit = vi.fn();
	const serveAsset = vi.fn(async () => new Response('must not serve'));
	const incoming = request(host, '/@static/favicon.svg');
	const response = await handleIngress(
		{ ...application, recordVisit },
		incoming,
		{},
		scheme,
		serveAsset
	);

	expect(response?.status).toBe(404);
	expect(await response?.text()).toBe('');
	expect(requestContext(incoming)).toBeUndefined();
	expect(serveAsset).not.toHaveBeenCalled();
	expect(recordVisit).not.toHaveBeenCalled();
});

test('does not trust forwarded authority unless explicitly configured', () => {
	const incoming = request('go.example.test');
	incoming.headers['x-forwarded-host'] = 'admin.example.test';

	expect(handleIngress(application, incoming, {})?.status).toBe(302);
});

test('rejects malformed ingress without reaching either handler', async () => {
	const incoming = request('admin.example.test/other');
	const response = handleIngress(application, incoming, {});

	expect(response?.status).toBe(400);
	expect(await response?.text()).toBe('');
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
	const missing = handleIngress(tracked, request('go.example.test', '/missing'), {});
	expect(missing?.status).toBe(404);
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
