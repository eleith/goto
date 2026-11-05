import type { PreparedDomain, PreparedLink, RedirectStatus } from '@goto/config';
import { describe, expect, test, vi } from 'vitest';
import { resolveRedirect } from './redirect.js';

const host = 'go.example.test';
const destination = 'https://destination.example.test/page';
const fallback = 'https://fallback.example.test/landing?owned=one#section';

function preparedLink(overrides: Partial<PreparedLink> = {}): PreparedLink {
	return {
		url: destination,
		title: 'Example',
		tags: [],
		enabled: true,
		status_code: 302,
		forward_query: false,
		provenance: { status_code: 'builtin', forward_query: 'builtin' },
		...overrides
	};
}

function preparedDomain(
	links: Record<string, PreparedLink> = {},
	fallback: PreparedDomain['fallback'] = 404
): PreparedDomain {
	return { links, fallback, provenance: { fallback: 'builtin' } };
}

describe('exact single-decode lookup', () => {
	const paths = ['/', '/docs', '/Docs', '/a/b', '/a//b', '/café', '/a+b', '/a%2Fb', '/100%'];
	const domain = preparedDomain(
		Object.fromEntries(
			paths.map((path, index) => [
				path,
				preparedLink({ url: `https://destination.example.test/${index}` })
			])
		)
	);

	test.each([
		['/', '/'],
		['/docs', '/docs'],
		['/Docs', '/Docs'],
		['/%64ocs', '/docs'],
		['/a/b', '/a/b'],
		['/a%2Fb', '/a/b'],
		['/a%2fb', '/a/b'],
		['/a//b', '/a//b'],
		['/a%2F%2Fb', '/a//b'],
		['/café', '/café'],
		['/caf%C3%A9', '/café'],
		['/a+b', '/a+b'],
		['/a%2Bb', '/a+b'],
		['/a%252Fb', '/a%2Fb'],
		['/100%25', '/100%'],
		['/docs?next=/missing?part=two', '/docs']
	])('%s resolves logical key %s', (target, path) => {
		const { response, visit } = resolveRedirect(domain, host, target, 'GET');

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(domain.links[path]?.url);
		expect(visit).toMatchObject({ path, outcome: 'valid' });
	});

	test.each([
		'/DOCS',
		'/docs/',
		'/docs/extra',
		'//docs',
		'/a/../docs',
		'/%2e/docs',
		'/docs%3Fignored=one',
		'/docs%23fragment'
	])('%s is not normalized, prefix-matched or reparsed', (target) => {
		const { response, visit } = resolveRedirect(domain, host, target, 'GET');

		expect(response.status).toBe(404);
		expect(visit?.outcome).toBe('invalid');
		expect(response.headers.has('location')).toBe(false);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	test('uses only own link keys, including prototype-like path names', () => {
		const links = {
			'/__proto__': preparedLink(),
			'/constructor': preparedLink(),
			'/hasOwnProperty': preparedLink()
		};
		Object.setPrototypeOf(links, { '/inherited': preparedLink() });
		const domain = preparedDomain(links);

		for (const path of Object.keys(links)) {
			expect(resolveRedirect(domain, host, path, 'GET').response.headers.get('location')).toBe(
				destination
			);
		}
		expect(resolveRedirect(domain, host, '/inherited', 'GET').response.status).toBe(404);
	});

	test('resolves only the supplied domain namespace', () => {
		const first = preparedDomain({ '/docs': preparedLink() });
		const second = preparedDomain({ '/other': preparedLink() });

		expect(resolveRedirect(first, host, '/docs', 'GET').response.status).toBe(302);
		expect(resolveRedirect(second, 'other.example.test', '/docs', 'GET').response.status).toBe(404);
	});
});

describe('HTTP responses', () => {
	test('serializes Unicode destinations as valid Location URLs without forwarding', () => {
		const url = 'https://例え.test/café?q=☕#完成';
		const domain = preparedDomain({ '/docs': preparedLink({ url }) });

		const { response } = resolveRedirect(domain, host, '/docs?ignored=one', 'GET');

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(new URL(url).href);
	});

	test.each([301, 302, 307, 308] satisfies RedirectStatus[])(
		'serves status %s with no-store',
		(status) => {
			const domain = preparedDomain({ '/docs': preparedLink({ status_code: status }) });
			const { response } = resolveRedirect(domain, host, '/docs', 'GET');

			expect(response.status).toBe(status);
			expect(response.headers.get('location')).toBe(destination);
			expect(response.headers.get('cache-control')).toBe('no-store');
		}
	);

	test.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE', 'get'])(
		'rejects %s without resolving a link or fallback',
		(method) => {
			const domain = preparedDomain({ '/docs': preparedLink() }, fallback);
			const { response, visit } = resolveRedirect(domain, host, '/docs', method);

			expect(response.status).toBe(405);
			expect(visit).toBeUndefined();
			expect(response.headers.get('allow')).toBe('GET, HEAD');
			expect(response.headers.get('cache-control')).toBe('no-store');
			expect(response.headers.has('location')).toBe(false);
		}
	);

	test.each([
		'',
		'*',
		'docs',
		'https://go.example.test/docs',
		'?name=value',
		'/docs#fragment',
		'/docs?name=value#fragment',
		'/doc s',
		'/docs?name=two words',
		'/docs\t',
		'/docs\r\n',
		'/docs\u0000',
		'/docs\u007f',
		'/docs\\other',
		'/docs\ud800',
		'/%',
		'/%GG',
		'/%C3%28',
		'/%FF'
	])('rejects malformed raw target %j before using fallback', (target) => {
		const domain = preparedDomain({}, fallback);
		const { response, visit } = resolveRedirect(domain, host, target, 'GET');

		expect(response.status).toBe(400);
		expect(visit).toBeUndefined();
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.has('location')).toBe(false);
	});

	test.each([
		{ target: '/docs', fallback: 404, status: 308 },
		{ target: '/missing', fallback, status: 302 },
		{ target: '/missing', fallback: 404, status: 404 },
		{ target: '/%', fallback, status: 400 }
	] satisfies { target: string; fallback: PreparedDomain['fallback']; status: number }[])(
		'HEAD matches GET status/headers with an empty body: $target $status',
		async ({ target, fallback, status }) => {
			const domain = preparedDomain({ '/docs': preparedLink({ status_code: 308 }) }, fallback);
			const { response: get } = resolveRedirect(domain, host, target, 'GET');
			const { response: head, visit } = resolveRedirect(domain, host, target, 'HEAD');

			expect(visit).toBeUndefined();

			expect(head.status).toBe(status);
			expect([...head.headers]).toEqual([...get.headers]);
			expect(head.body).toBeNull();
			expect(await head.text()).toBe('');
		}
	);
});

describe('validity and fallback', () => {
	const from = '2030-01-01T01:00:00+01:00';
	const until = '2030-01-02T00:00:00Z';
	const start = Date.parse(from);
	const end = Date.parse(until);

	test.each([
		{ enabled: true, now: start - 1, status: 302, location: fallback, outcome: 'invalid' },
		{ enabled: true, now: start, status: 307, location: destination, outcome: 'valid' },
		{ enabled: true, now: end - 1, status: 307, location: destination, outcome: 'valid' },
		{ enabled: true, now: end, status: 302, location: fallback, outcome: 'invalid' },
		{ enabled: true, now: end + 1, status: 302, location: fallback, outcome: 'invalid' },
		{ enabled: false, now: start, status: 302, location: fallback, outcome: 'invalid' }
	])('enabled=$enabled at $now returns $status', ({ enabled, now, status, location, outcome }) => {
		const domain = preparedDomain(
			{
				'/docs': preparedLink({
					enabled,
					valid_from: from,
					valid_until: until,
					status_code: 307
				})
			},
			fallback
		);
		const { response, visit } = resolveRedirect(domain, host, '/docs?incoming=ignored', 'GET', now);

		expect(response.status).toBe(status);
		expect(visit).toEqual({ domain: host, path: '/docs', outcome, visitedAt: now });
		expect(response.headers.get('location')).toBe(location);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	test('visit outcomes do not change with later link configuration', () => {
		const link = preparedLink();
		const domain = preparedDomain({ '/docs': link }, fallback);
		const first = resolveRedirect(domain, host, '/docs', 'GET');
		link.enabled = false;
		const next = resolveRedirect(domain, host, '/docs', 'GET');
		expect(first.visit?.outcome).toBe('valid');
		expect(next.visit?.outcome).toBe('invalid');
	});

	test('uses Date.now when no clock is supplied', () => {
		const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
		try {
			const domain = preparedDomain({ '/docs': preparedLink({ valid_from: from }) });

			const { response, visit } = resolveRedirect(domain, host, '/docs', 'GET');
			expect(response.status).toBe(302);
			expect(visit).toEqual({ domain: host, path: '/docs', outcome: 'valid', visitedAt: start });
		} finally {
			clock.mockRestore();
		}
	});

	test.each([preparedLink({ enabled: false }), preparedLink({ valid_until: until })])(
		'inactive links can fall back to 404',
		(link) => {
			const domain = preparedDomain({ '/docs': link });
			const { response, visit } = resolveRedirect(domain, host, '/docs', 'GET', end);

			expect(response.status).toBe(404);
			expect(visit?.outcome).toBe('invalid');
			expect(response.headers.has('location')).toBe(false);
			expect(response.headers.get('cache-control')).toBe('no-store');
		}
	);

	test('a root link takes precedence over URL fallback', () => {
		const domain = preparedDomain({ '/': preparedLink() }, fallback);

		const { response, visit } = resolveRedirect(domain, host, '/?incoming=ignored', 'GET');
		expect(response.headers.get('location')).toBe(destination);
		expect(visit).toMatchObject({ path: '/', outcome: 'valid' });
	});

	test('an unconfigured root remains a base visit with an invalid outcome', () => {
		const domain = preparedDomain();
		const { response, visit } = resolveRedirect(domain, host, '/', 'GET');
		expect(response.status).toBe(404);
		expect(visit).toMatchObject({ path: '/', outcome: 'invalid' });
	});

	test('URL fallback is always 302 and never appends the incoming path or query', () => {
		const domain = preparedDomain({}, fallback);
		const { response, visit } = resolveRedirect(
			domain,
			host,
			'/missing/nested?owned=replaced&new=value',
			'GET'
		);

		expect(response.status).toBe(302);
		expect(visit).toMatchObject({ path: '/missing/nested', outcome: 'invalid' });
		expect(response.headers.get('location')).toBe(fallback);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});

describe('query forwarding', () => {
	test('off preserves the authored URL exactly', () => {
		const authored = 'https://TARGET.example.test:443/p%61th?tag=old&keep=%2f&tag=older#part%20one';
		const domain = preparedDomain({ '/docs': preparedLink({ url: authored }) });
		const { response } = resolveRedirect(domain, host, '/docs?tag=new&incoming=yes', 'GET');

		expect(response.headers.get('location')).toBe(authored);
	});

	test.each([
		{
			query: 'tag=one&tag=two&empty=&new=x%2By&word=a+b',
			expected:
				'https://destination.example.test/page?keep=first&keep=second&tag=one&tag=two&empty=&new=x%2By&word=a+b#part'
		},
		{
			query: 'tag=one&new=middle&tag=two',
			expected:
				'https://destination.example.test/page?keep=first&keep=second&empty=old&tag=one&new=middle&tag=two#part'
		},
		{
			query: '%74ag=one&tag=two&tag=',
			expected:
				'https://destination.example.test/page?keep=first&keep=second&empty=old&tag=one&tag=two&tag=#part'
		}
	])('replaces complete value groups: $query', ({ query, expected }) => {
		const authored =
			'https://destination.example.test/page?keep=first&tag=old&keep=second&tag=older&empty=old#part';
		const domain = preparedDomain({
			'/docs': preparedLink({ url: authored, forward_query: true })
		});
		const { response } = resolveRedirect(domain, host, `/docs?${query}`, 'GET');

		expect(response.headers.get('location')).toBe(expected);
		expect(domain.links['/docs']?.url).toBe(authored);
	});

	test.each(['/docs', '/docs?'])(
		'no incoming parameters preserves the destination: %s',
		(target) => {
			const authored = 'https://TARGET.example.test:443/p%61th?keep=%2f#fragment';
			const domain = preparedDomain({
				'/docs': preparedLink({ url: authored, forward_query: true })
			});

			expect(resolveRedirect(domain, host, target, 'GET').response.headers.get('location')).toBe(
				authored
			);
		}
	);
});

describe('direct self-loops', () => {
	test.each([
		['/', 'https://GO.EXAMPLE.TEST:443/?changed=one#fragment'],
		['/%64ocs?incoming=one', 'https://go.example.test/docs?different=two'],
		['/a%2Fb', 'https://go.example.test/a/b#fragment'],
		['/docs', 'http://go.example.test:80/docs'],
		['/docs', 'https:///go.example.test/docs']
	])('runtime blocks a direct fallback loop: %s -> %s', (target, fallback) => {
		const { response } = resolveRedirect(preparedDomain({}, fallback), host, target, 'GET');

		expect(response.status).toBe(404);
		expect(response.headers.has('location')).toBe(false);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	test('runtime also guards a direct link loop if startup validation was skipped', () => {
		const domain = preparedDomain({
			'/docs': preparedLink({ url: 'https://go.example.test/docs' })
		});

		expect(resolveRedirect(domain, host, '/docs', 'GET').response.status).toBe(404);
	});

	test('allows fallback to a different local path without graph analysis', () => {
		const domain = preparedDomain({}, 'https://go.example.test/landing');

		expect(resolveRedirect(domain, host, '/missing', 'GET').response.headers.get('location')).toBe(
			'https://go.example.test/landing'
		);
		expect(resolveRedirect(domain, host, '/landing', 'GET').response.status).toBe(404);
	});
});
