import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, test } from 'vitest';
import { isLocalProbe, readIngress } from './ingress.js';

function request(
	headers: Record<string, string | string[] | undefined> = { host: 'go.example.test' },
	target = '/docs?topic=one'
): IncomingMessage {
	const incoming = new IncomingMessage(new Socket());
	incoming.headers = headers;
	incoming.url = target;
	incoming.method = 'GET';
	return incoming;
}

const forwarding = {
	HOST_HEADER: 'X-Forwarded-Host',
	PROTOCOL_HEADER: 'X-Forwarded-Proto',
	PORT_HEADER: 'X-Forwarded-Port'
};

describe('readIngress', () => {
	test('defaults to the native adapter HTTPS origin, ignoring unconfigured headers', () => {
		const incoming = request({
			host: 'GO.example.test:8443',
			'x-forwarded-host': 'other.example.test',
			'x-forwarded-proto': 'http',
			'x-forwarded-port': '1234',
			forwarded: 'host=other.example.test;proto=http'
		});
		const result = readIngress(incoming, { ORIGIN: 'http://fixed.example.test' });

		expect(result?.url.href).toBe('https://go.example.test:8443/docs?topic=one');
		expect(result?.host).toBe('go.example.test:8443');
	});

	test('ignores malformed forwarding values unless their header names are configured', () => {
		const incoming = request({
			host: 'go.example.test',
			'x-forwarded-host': ['untrusted.example.test'],
			'x-forwarded-proto': 'https,http',
			'x-forwarded-port': 'invalid'
		});
		expect(readIngress(incoming, {})?.url.origin).toBe('https://go.example.test');
	});

	test('allows the Vite caller to supply HTTP without overriding a configured protocol', () => {
		const incoming = request({ host: 'localhost:5173', 'x-forwarded-proto': 'https' });
		expect(readIngress(incoming, {}, 'http')?.url.origin).toBe('http://localhost:5173');
		expect(readIngress(incoming, forwarding, 'http')?.url.origin).toBe('https://localhost:5173');
	});

	test.each([
		[undefined, 'https'],
		['', 'https'],
		['http', 'http'],
		['HTTPS', 'https'],
		['%68ttp%73', 'https']
	])('uses native protocol decoding and fallback for %s', (value, expected) => {
		const incoming = request({ host: 'go.example.test', 'x-forwarded-proto': value });
		expect(readIngress(incoming, forwarding)?.url.origin).toBe(`${expected}://go.example.test`);
	});

	test.each([undefined, ''])('falls back to Host when configured host is %s', (value) => {
		const incoming = request({ host: 'go.example.test:8080', 'x-forwarded-host': value });
		const result = readIngress(incoming, forwarding);
		expect(result?.url.origin).toBe('https://go.example.test:8080');
		expect(result?.host).toBe('go.example.test:8080');
	});

	test('uses configured forwarding names case-insensitively, without a Goto prefix', () => {
		const incoming = request({
			host: 'private.internal:3000',
			'x-forwarded-host': 'BÜCHER.example',
			'x-forwarded-proto': 'http',
			'x-forwarded-port': '8080'
		});
		const result = readIngress(incoming, forwarding);
		expect(result?.url.href).toBe('http://xn--bcher-kva.example:8080/docs?topic=one');
		expect(result?.host).toBe('xn--bcher-kva.example:8080');
	});

	test.each([
		['https', 'go.example.test:443', 'https://go.example.test', 'go.example.test'],
		['http', 'go.example.test:80', 'http://go.example.test', 'go.example.test:80'],
		['http', 'go.example.test:443', 'http://go.example.test:443', 'go.example.test'],
		['https', '[2001:db8::1]:8443', 'https://[2001:db8::1]:8443', '[2001:db8::1]:8443']
	])(
		'preserves native origin and config host identity for %s %s',
		(protocol, host, origin, key) => {
			const result = readIngress(request({ host, 'x-forwarded-proto': protocol }), forwarding);
			expect(result?.url.origin).toBe(origin);
			expect(result?.host).toBe(key);
		}
	);

	test.each(['443', '00443'])('lets the URL normalize the separate port %s', (port) => {
		const result = readIngress(
			request({ host: 'go.example.test', 'x-forwarded-port': port }),
			forwarding
		);
		expect(result?.url.origin).toBe('https://go.example.test');
		expect(result?.host).toBe('go.example.test');
	});

	test('concatenates origin and target like native getRequest, not relative URL resolution', () => {
		const target = '//other.example.test/%64ocs?topic=two';
		const result = readIngress(request({ host: 'go.example.test' }, target), {});
		expect(result?.url.href).toBe(new Request(`https://go.example.test${target}`).url);
		expect(result?.url.origin).toBe('https://go.example.test');
	});

	test.each([
		undefined,
		'',
		['go.example.test'],
		['first.example.test', 'second.example.test'],
		'first.example.test,second.example.test',
		'first%2csecond.example.test',
		'go.example.test/path',
		'go.example.test?query',
		'go.example.test#fragment',
		'user@go.example.test',
		'https://go.example.test',
		'go.example.test\\path',
		'go.example.test\r\nInjected: value',
		'go.example.test\u007f',
		' go.example.test',
		'go.example.test:',
		'go.example.test:0',
		'go.example.test:65536',
		'go.example.test:abc',
		'[::1',
		'::1',
		'%zz.example.test',
		'go.example.test\ud800'
	])('rejects invalid or absent authority %j', (host) => {
		expect(readIngress(request({ host }), {})).toBeUndefined();
	});

	test('does not require a Host fallback when the configured authority is present', () => {
		const incoming = request({ 'x-forwarded-host': 'go.example.test' });
		expect(readIngress(incoming, forwarding)?.host).toBe('go.example.test');
	});

	test.each(['host', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port'])(
		'rejects ambiguous raw headers for %s',
		(name) => {
			const incoming = request({
				host: 'private.internal',
				'x-forwarded-host': 'go.example.test',
				'x-forwarded-proto': 'https',
				'x-forwarded-port': '8443'
			});
			incoming.rawHeaders = [name, 'first', name.toUpperCase(), 'second'];
			expect(readIngress(incoming, forwarding)).toBeUndefined();
		}
	);

	test.each([
		['x-forwarded-host', ['go.example.test']],
		['x-forwarded-host', 'bad.example.test/path'],
		['x-forwarded-host', 'first.example.test, second.example.test'],
		['x-forwarded-proto', ['https']],
		['x-forwarded-proto', 'https,http'],
		['x-forwarded-proto', 'https:'],
		['x-forwarded-proto', 'ftp'],
		['x-forwarded-proto', '%zz'],
		['x-forwarded-proto', '%0ahttps'],
		['x-forwarded-proto', 'https\\'],
		['x-forwarded-port', ['443']],
		['x-forwarded-port', '443,80'],
		['x-forwarded-port', ' 443'],
		['x-forwarded-port', '+443'],
		['x-forwarded-port', '0x1bb'],
		['x-forwarded-port', '443.0'],
		['x-forwarded-port', '0'],
		['x-forwarded-port', '65536']
	] satisfies [string, string | string[]][])(
		'rejects malformed configured header %s: %j without falling back',
		(name, value) => {
			const incoming = request({ host: 'go.example.test', [name]: value });
			expect(readIngress(incoming, forwarding)).toBeUndefined();
		}
	);

	test('rejects a separate port when the authority already includes one', () => {
		const incoming = request({ host: 'go.example.test:8443', 'x-forwarded-port': '443' });
		expect(readIngress(incoming, forwarding)).toBeUndefined();
	});

	test.each(['', '*', 'https://other.example.test/docs', '/docs\\other', '/docs\n', '/docs#hash'])(
		'rejects a malformed request target %j',
		(target) => {
			expect(readIngress(request({ host: 'go.example.test' }, target), {})).toBeUndefined();
		}
	);

	test('returns undefined when the request target is missing', () => {
		const incoming = request();
		delete incoming.url;
		expect(readIngress(incoming, {})).toBeUndefined();
	});
});

function probe(remoteAddress?: string, method = 'GET'): IncomingMessage {
	const incoming = request({}, '/healthz');
	incoming.method = method;
	Object.defineProperty(incoming.socket, 'remoteAddress', { value: remoteAddress });
	return incoming;
}

describe('isLocalProbe', () => {
	test.each([
		['http://localhost:3000/healthz', '127.0.0.1', 'GET'],
		['https://127.1.2.3:8443/healthz?ready=1', '127.0.0.2', 'HEAD'],
		['http://[::1]/healthz', '::1', 'GET'],
		['http://[0:0:0:0:0:0:0:1]:5173/healthz', '0:0:0:0:0:0:0:1', 'HEAD'],
		['http://localhost/healthz', '::ffff:127.0.0.1', 'GET'],
		['http://[::ffff:127.0.0.2]/healthz', '::ffff:7f00:1', 'GET']
	])('allows local probe %s from %s using %s', (url, address, method) => {
		expect(isLocalProbe(probe(address, method), new URL(url))).toBe(true);
	});

	test.each([
		['http://external.example.test/healthz', '127.0.0.1', 'GET'],
		['http://localhost.external.example.test/healthz', '127.0.0.1', 'GET'],
		['http://sub.localhost/healthz', '127.0.0.1', 'GET'],
		['http://localhost/healthz', '192.0.2.1', 'GET'],
		['http://localhost/healthz', '::ffff:192.0.2.1', 'GET'],
		['http://localhost/healthz', undefined, 'GET'],
		['http://localhost/healthz', '127.0.0.1', 'POST'],
		['http://localhost/healthz', '127.0.0.1', 'OPTIONS'],
		['http://localhost/healthz/', '127.0.0.1', 'GET'],
		['http://localhost/%68ealthz', '127.0.0.1', 'GET'],
		['http://localhost/other', '127.0.0.1', 'GET']
	] as const)(
		'rejects nonlocal or nonprobe request %s from %s using %s',
		(url, address, method) => {
			const incoming = probe(address, method);
			incoming.headers = { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '::1' };
			expect(isLocalProbe(incoming, new URL(url))).toBe(false);
		}
	);
});
