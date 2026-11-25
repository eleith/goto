import {
	loadConfig,
	type LinkConfiguration,
	type PreparedDomain,
	type PreparedLink,
	type RedirectResponse,
	type RedirectStatus
} from '@goto/config';
import { describe, expect, test, vi } from 'vitest';
import { resolveRedirect } from './redirect.js';

const host = 'go.example.test';
const destination = 'https://destination.example.test/page';
const fallbackUrl = 'https://fallback.example.test/landing?owned=one#section';
const fallback = preparedResponse({ url: fallbackUrl });

function zeroLinkVisitCount(): number {
	return 0;
}

function preparedResponse(overrides: Partial<RedirectResponse> = {}): RedirectResponse {
	return { url: destination, status_code: 302, forward_query: false, ...overrides };
}

function preparedLink(overrides: Partial<PreparedLink> = {}): PreparedLink {
	return {
		url: destination,
		title: 'Example',
		tags: [],
		enabled: true,
		status_code: 302,
		forward_query: false,
		case_insensitive: false,
		ignore_trailing_slash: false,
		forward_path: false,
		provenance: {
			status_code: 'builtin',
			forward_query: 'builtin',
			case_insensitive: 'link',
			ignore_trailing_slash: 'link',
			forward_path: 'builtin'
		},
		...overrides
	};
}

function preparedDomain(
	links: Record<string, PreparedLink> = {},
	fallback: PreparedDomain['fallback'] = null,
	root: PreparedDomain['root'] = null
): PreparedDomain {
	return { root, links, fallback, caseInsensitivePaths: {}, provenance: { fallback: 'builtin' } };
}

describe('exact single-decode lookup', () => {
	const paths = ['/docs', '/Docs', '/a/b', '/a//b', '/café', '/a+b', '/a%2Fb', '/100%'];
	const domain = preparedDomain(
		Object.fromEntries(
			paths.map((path, index) => [
				path,
				preparedLink({ url: `https://destination.example.test/${index}` })
			])
		),
		null,
		preparedResponse()
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
		const { response, visit } = resolveRedirect(domain, host, target, 'GET', zeroLinkVisitCount);

		expect(response.status).toBe(302);
		const expectedUrl = path === '/' ? domain.root?.url : domain.links[path]?.url;
		expect(response.headers.get('location')).toBe(expectedUrl);
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
		const { response, visit } = resolveRedirect(domain, host, target, 'GET', zeroLinkVisitCount);

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
			expect(
				resolveRedirect(domain, host, path, 'GET', zeroLinkVisitCount).response.headers.get(
					'location'
				)
			).toBe(destination);
		}
		expect(
			resolveRedirect(domain, host, '/inherited', 'GET', zeroLinkVisitCount).response.status
		).toBe(404);
	});

	test('resolves only the supplied domain namespace', () => {
		const first = preparedDomain({ '/docs': preparedLink() });
		const second = preparedDomain({ '/other': preparedLink() });

		expect(resolveRedirect(first, host, '/docs', 'GET', zeroLinkVisitCount).response.status).toBe(
			302
		);
		expect(
			resolveRedirect(second, 'other.example.test', '/docs', 'GET', zeroLinkVisitCount).response
				.status
		).toBe(404);
	});
});

type LinkInput = Pick<LinkConfiguration, 'url'> & Partial<LinkConfiguration>;

function matchingDomain(links: Record<string, LinkInput>): PreparedDomain {
	return loadConfig(
		{
			auth: { credentials: { username: 'example', password: 'unit-only-password' } },
			domains: { [host]: { links } }
		},
		{ env: {} }
	).domains[host]!;
}

describe('flexible matching and forwarding', () => {
	test('built-in aliases count against the authored key without enabling prefix matching', () => {
		const domain = matchingDomain({ '/Docs': { url: destination } });
		const matched = resolveRedirect(domain, host, '/DOCS/', 'GET', zeroLinkVisitCount);
		expect(matched.response.headers.get('location')).toBe(destination);
		expect(matched.visit).toMatchObject({ path: '/Docs', outcome: 'valid' });
		expect(matched.response.headers.has('vary')).toBe(false);

		const unmatched = resolveRedirect(domain, host, '/docs/install', 'GET', zeroLinkVisitCount);
		expect(unmatched.response.status).toBe(404);
		expect(unmatched.visit).toMatchObject({ path: '/docs/install', outcome: 'invalid' });
	});

	test('forwards a conditional destination path before independently merging query parameters', () => {
		const domain = matchingDomain({
			'/docs': {
				url: destination,
				redirect: [
					{
						if: { language: 'fr' },
						to: 'https://TARGET.example.test:443/base/?tag=old&keep=%2f#part'
					},
					{ if: { os: 'ios' }, to: 'https://destination.example.test/ios' }
				],
				status_code: 308,
				forward_path: true,
				forward_query: true
			}
		});
		const target = '/DOCS/Install%20Guide/%252F?tag=one&tag=two';
		const options = { acceptLanguage: 'fr-CA,en;q=0.5' };
		const { response, visit } = resolveRedirect(
			domain,
			host,
			target,
			'GET',
			zeroLinkVisitCount,
			options
		);
		expect(response.headers.get('location')).toBe(
			'https://target.example.test/base/Install%20Guide/%252F?keep=%2F&tag=one&tag=two#part'
		);
		expect(visit).toMatchObject({ path: '/docs', outcome: 'valid' });
		expect(response.status).toBe(308);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('vary')).toBe('Accept-Language, User-Agent');
		const head = resolveRedirect(domain, host, target, 'HEAD', zeroLinkVisitCount, options);
		expect([...head.response.headers]).toEqual([...response.headers]);
		expect(head.visit).toBeUndefined();
	});

	test('path forwarding does not enable query forwarding or rewrite an exact destination', () => {
		const authored = 'https://TARGET.example.test:443/base/?tag=old&keep=%2f#part';
		const domain = matchingDomain({ '/docs': { url: authored, forward_path: true } });
		expect(
			resolveRedirect(
				domain,
				host,
				'/docs/Install?tag=new',
				'GET',
				zeroLinkVisitCount
			).response.headers.get('location')
		).toBe('https://target.example.test/base/Install?tag=old&keep=%2f#part');
		expect(
			resolveRedirect(
				domain,
				host,
				'/docs?tag=new',
				'GET',
				zeroLinkVisitCount
			).response.headers.get('location')
		).toBe(authored);
	});

	test('the most specific match owns its suffix and captured identity', () => {
		const domain = matchingDomain({
			'/docs': { url: destination, forward_path: true },
			'/docs/api': { url: 'https://api.example.test/reference', forward_path: true }
		});
		const { response, visit } = resolveRedirect(
			domain,
			host,
			'/DOCS/api/Start',
			'GET',
			zeroLinkVisitCount
		);
		expect(response.headers.get('location')).toBe('https://api.example.test/reference/Start');
		expect(visit).toMatchObject({ path: '/docs/api', outcome: 'valid' });
	});

	test('an inactive prefix winner uses fallback without forwarding its suffix or trying a parent', () => {
		const domain = matchingDomain({
			'/docs': { url: destination, forward_path: true },
			'/docs/private': {
				url: destination,
				redirect: [{ if: { language: 'fr' }, to: 'https://destination.example.test/private' }],
				forward_path: true,
				enabled: false
			}
		});
		domain.fallback = fallback;
		const { response, visit } = resolveRedirect(
			domain,
			host,
			'/DOCS/private/secret?x=1',
			'GET',
			zeroLinkVisitCount,
			{
				acceptLanguage: 'fr'
			}
		);
		expect(response.headers.get('location')).toBe(fallbackUrl);
		expect(response.headers.has('vary')).toBe(false);
		expect(visit).toMatchObject({ path: '/docs/private', outcome: 'invalid' });
	});

	test.each(['/docs/%2E%2E/secret', '/docs/%5Csecret', '/docs/%00'])(
		'does not turn dangerous decoded suffixes into forwarded paths: %s',
		(target) => {
			const domain = matchingDomain({ '/docs': { url: destination, forward_path: true } });
			const { response, visit } = resolveRedirect(domain, host, target, 'GET', zeroLinkVisitCount);
			expect(response.status).toBe(404);
			expect(response.headers.has('location')).toBe(false);
			expect(visit?.outcome).toBe('invalid');
		}
	);

	test('a selected conditional loop is blocked without trying the next matching rule', () => {
		const domain = matchingDomain({ '/docs': { url: destination, forward_path: true } });
		domain.links['/docs']!.redirect = [
			{ if: { language: 'fr' }, to: 'https://go.example.test/DOCS/again' },
			{ if: { os: 'ios' }, to: destination }
		];
		const { response, visit } = resolveRedirect(
			domain,
			host,
			'/docs/start',
			'GET',
			zeroLinkVisitCount,
			{
				acceptLanguage: 'fr',
				userAgent: 'iPhone'
			}
		);
		expect(response.status).toBe(404);
		expect(response.headers.has('location')).toBe(false);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('vary')).toBe('Accept-Language, User-Agent');
		expect(visit).toMatchObject({ path: '/docs', outcome: 'invalid' });
	});
});

describe('named-link visit limits', () => {
	test('an exhausted prefix winner uses its canonical count and fallback, never its parent', () => {
		const domain = matchingDomain({
			'/docs': { url: destination, forward_path: true },
			'/docs/private': {
				url: destination,
				max_visits: 2,
				forward_path: true,
				redirect: [{ if: { language: 'fr' }, to: 'https://example.org/private' }]
			}
		});
		domain.fallback = fallback;
		const linkVisitCount = vi.fn(() => 2);
		const { response, visit } = resolveRedirect(
			domain,
			host,
			'/DOCS/private/secret?x=1',
			'GET',
			linkVisitCount,
			{ acceptLanguage: 'fr' }
		);

		expect(linkVisitCount).toHaveBeenCalledExactlyOnceWith(host, '/docs/private');
		expect(response.headers.get('location')).toBe(fallbackUrl);
		expect(response.headers.has('vary')).toBe(false);
		expect(visit).toMatchObject({ path: '/docs/private', outcome: 'invalid' });
	});
});

describe('HTTP responses', () => {
	test('a conditional miss keeps the link default and varies on every configured predicate', () => {
		const domain = preparedDomain(
			{
				'/docs': preparedLink({
					redirect: [
						{ if: { language: 'fr' }, to: 'https://destination.example.test/french' },
						{ if: { os: 'ios' }, to: 'https://destination.example.test/ios' }
					]
				})
			},
			fallback
		);
		const { response, visit } = resolveRedirect(domain, host, '/docs', 'GET', zeroLinkVisitCount, {
			acceptLanguage: 'en',
			userAgent: 'Unknown agent'
		});

		expect(response.headers.get('location')).toBe(destination);
		expect(response.headers.get('vary')).toBe('Accept-Language, User-Agent');
		expect(visit).toMatchObject({ path: '/docs', outcome: 'valid' });
	});

	test('serializes Unicode destinations as valid Location URLs without forwarding', () => {
		const url = 'https://例え.test/café?q=☕#完成';
		const domain = preparedDomain({ '/docs': preparedLink({ url }) });

		const { response } = resolveRedirect(
			domain,
			host,
			'/docs?ignored=one',
			'GET',
			zeroLinkVisitCount
		);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(new URL(url).href);
	});

	test.each([301, 302, 307, 308] satisfies RedirectStatus[])(
		'serves status %s with no-store',
		(status) => {
			const domain = preparedDomain({ '/docs': preparedLink({ status_code: status }) });
			const { response } = resolveRedirect(domain, host, '/docs', 'GET', zeroLinkVisitCount);

			expect(response.status).toBe(status);
			expect(response.headers.get('location')).toBe(destination);
			expect(response.headers.get('cache-control')).toBe('no-store');
		}
	);

	test.each(['POST', 'get'])('rejects %s without resolving a link or fallback', (method) => {
		const domain = preparedDomain({ '/docs': preparedLink() }, fallback);
		const { response, visit } = resolveRedirect(domain, host, '/docs', method, zeroLinkVisitCount);

		expect(response.status).toBe(405);
		expect(visit).toBeUndefined();
		expect(response.headers.get('allow')).toBe('GET, HEAD');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.has('location')).toBe(false);
	});

	test.each(['/%GG', '/%C3%28'])(
		'rejects an undecodable path %j before using fallback',
		(target) => {
			const domain = preparedDomain({}, fallback);
			const { response, visit } = resolveRedirect(domain, host, target, 'GET', zeroLinkVisitCount);

			expect(response.status).toBe(400);
			expect(visit).toBeUndefined();
			expect(response.headers.get('cache-control')).toBe('no-store');
			expect(response.headers.has('location')).toBe(false);
		}
	);

	test.each([
		{ target: '/docs', fallback: null, root: null, status: 308 },
		{
			target: '/?incoming=one',
			fallback,
			root: preparedResponse({ status_code: 301, forward_query: true }),
			status: 301
		},
		{ target: '/?owned=changed', fallback, root: null, status: 302 },
		{
			target: '/missing?owned=changed',
			fallback: preparedResponse({ url: fallbackUrl, status_code: 307, forward_query: true }),
			root: null,
			status: 307
		},
		{ target: '/missing', fallback: null, root: null, status: 404 },
		{ target: '/%', fallback, root: null, status: 400 }
	] satisfies {
		target: string;
		fallback: PreparedDomain['fallback'];
		root: PreparedDomain['root'];
		status: number;
	}[])(
		'HEAD matches GET status/headers with an empty body: $target $status',
		async ({ target, fallback, root, status }) => {
			const domain = preparedDomain(
				{ '/docs': preparedLink({ status_code: 308 }) },
				fallback,
				root
			);
			const { response: get } = resolveRedirect(domain, host, target, 'GET', zeroLinkVisitCount);
			const { response: head, visit } = resolveRedirect(
				domain,
				host,
				target,
				'HEAD',
				zeroLinkVisitCount
			);

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
		{ enabled: true, now: start - 1, status: 302, location: fallbackUrl, outcome: 'invalid' },
		{ enabled: true, now: start, status: 307, location: destination, outcome: 'valid' },
		{ enabled: true, now: end - 1, status: 307, location: destination, outcome: 'valid' },
		{ enabled: true, now: end, status: 302, location: fallbackUrl, outcome: 'invalid' },
		{ enabled: true, now: end + 1, status: 302, location: fallbackUrl, outcome: 'invalid' },
		{ enabled: false, now: start, status: 302, location: fallbackUrl, outcome: 'invalid' }
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
		const { response, visit } = resolveRedirect(
			domain,
			host,
			'/docs?incoming=ignored',
			'GET',
			zeroLinkVisitCount,
			{
				now
			}
		);

		expect(response.status).toBe(status);
		expect(visit).toEqual({ domain: host, path: '/docs', outcome, visitedAt: now });
		expect(response.headers.get('location')).toBe(location);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	test('visit outcomes do not change with later link configuration', () => {
		const link = preparedLink();
		const domain = preparedDomain({ '/docs': link }, fallback);
		const first = resolveRedirect(domain, host, '/docs', 'GET', zeroLinkVisitCount);
		link.enabled = false;
		const next = resolveRedirect(domain, host, '/docs', 'GET', zeroLinkVisitCount);
		expect(first.visit?.outcome).toBe('valid');
		expect(next.visit?.outcome).toBe('invalid');
	});

	test('uses Date.now when no clock is supplied', () => {
		const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
		try {
			const domain = preparedDomain({ '/docs': preparedLink({ valid_from: from }) });

			const { response, visit } = resolveRedirect(domain, host, '/docs', 'GET', zeroLinkVisitCount);
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
			const { response, visit } = resolveRedirect(
				domain,
				host,
				'/docs',
				'GET',
				zeroLinkVisitCount,
				{ now: end }
			);

			expect(response.status).toBe(404);
			expect(visit?.outcome).toBe('invalid');
			expect(response.headers.has('location')).toBe(false);
			expect(response.headers.get('cache-control')).toBe('no-store');
		}
	);

	test('a configured root uses its own response options and only matches the root path', () => {
		const root = preparedResponse({
			url: 'https://destination.example.test/home',
			status_code: 308,
			forward_query: true
		});
		const domain = preparedDomain({}, fallback, root);

		const { response, visit } = resolveRedirect(
			domain,
			host,
			'/?from=root',
			'GET',
			zeroLinkVisitCount
		);
		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe(
			'https://destination.example.test/home?from=root'
		);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(visit).toMatchObject({ path: '/', outcome: 'valid' });

		const missing = resolveRedirect(domain, host, '/home', 'GET', zeroLinkVisitCount);
		expect(missing.response.headers.get('location')).toBe(fallbackUrl);
		expect(missing.visit).toMatchObject({ path: '/home', outcome: 'invalid' });
	});

	test('a root request using fallback is still a valid Root visit', () => {
		const domain = preparedDomain({}, fallback);
		const { response, visit } = resolveRedirect(
			domain,
			host,
			'/?incoming=ignored',
			'GET',
			zeroLinkVisitCount
		);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(fallbackUrl);
		expect(visit).toMatchObject({ path: '/', outcome: 'valid' });
	});

	test('a root request returning 404 is still a valid Root visit', () => {
		const domain = preparedDomain();
		const { response, visit } = resolveRedirect(domain, host, '/', 'GET', zeroLinkVisitCount);
		expect(response.status).toBe(404);
		expect(visit).toMatchObject({ path: '/', outcome: 'valid' });
	});

	test('default fallback options preserve the URL without appending the incoming path or query', () => {
		const domain = preparedDomain({}, fallback);
		const { response, visit } = resolveRedirect(
			domain,
			host,
			'/missing/nested?owned=replaced&new=value',
			'GET',
			zeroLinkVisitCount
		);

		expect(response.status).toBe(302);
		expect(visit).toMatchObject({ path: '/missing/nested', outcome: 'invalid' });
		expect(response.headers.get('location')).toBe(fallbackUrl);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	test('fallback honors its own response options for an inactive named link', () => {
		const configuredFallback = preparedResponse({
			url: fallbackUrl,
			status_code: 307,
			forward_query: true
		});
		const domain = preparedDomain(
			{ '/disabled': preparedLink({ enabled: false }) },
			configuredFallback
		);

		const { response, visit } = resolveRedirect(
			domain,
			host,
			'/disabled?incoming=present',
			'GET',
			zeroLinkVisitCount
		);

		expect(response.status).toBe(307);
		expect(response.headers.get('location')).toBe(
			'https://fallback.example.test/landing?owned=one&incoming=present#section'
		);
		expect(visit).toMatchObject({ path: '/disabled', outcome: 'invalid' });
	});
});

describe('query forwarding', () => {
	test('off preserves the authored URL exactly', () => {
		const authored = 'https://TARGET.example.test:443/p%61th?tag=old&keep=%2f&tag=older#part%20one';
		const domain = preparedDomain({ '/docs': preparedLink({ url: authored }) });
		const { response } = resolveRedirect(
			domain,
			host,
			'/docs?tag=new&incoming=yes',
			'GET',
			zeroLinkVisitCount
		);

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
		const { response } = resolveRedirect(domain, host, `/docs?${query}`, 'GET', zeroLinkVisitCount);

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

			expect(
				resolveRedirect(domain, host, target, 'GET', zeroLinkVisitCount).response.headers.get(
					'location'
				)
			).toBe(authored);
		}
	);
});

describe('direct self-loops', () => {
	test.each([
		['/', 'https://GO.EXAMPLE.TEST:443/?changed=one#fragment', 'valid'],
		['/%64ocs?incoming=one', 'https://go.example.test/docs?different=two', 'invalid'],
		['/a%2Fb', 'https://go.example.test/a/b#fragment', 'invalid'],
		['/docs', 'http://go.example.test:80/docs', 'invalid'],
		['/docs', 'https:///go.example.test/docs', 'invalid']
	])('runtime blocks a direct fallback loop: %s -> %s', (target, url, expectedOutcome) => {
		const domain = preparedDomain({}, preparedResponse({ url, forward_query: true }));
		const { response, visit } = resolveRedirect(domain, host, target, 'GET', zeroLinkVisitCount);

		expect(response.status).toBe(404);
		expect(visit?.outcome).toBe(expectedOutcome);
		expect(response.headers.has('location')).toBe(false);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	test('a Root loop is blocked with 404 without making the Root request invalid', () => {
		const root = preparedResponse({
			url: 'https://GO.EXAMPLE.TEST:443/?owned=old#section',
			forward_query: true
		});
		const domain = preparedDomain({}, fallback, root);
		const { response, visit } = resolveRedirect(
			domain,
			host,
			'/?owned=new',
			'GET',
			zeroLinkVisitCount
		);

		expect(response.status).toBe(404);
		expect(response.headers.has('location')).toBe(false);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(visit).toMatchObject({ path: '/', outcome: 'valid' });
	});

	test('a direct link loop returns an invalid 404 without trying fallback', () => {
		const domain = preparedDomain(
			{ '/docs': preparedLink({ url: 'https://go.example.test/docs' }) },
			fallback
		);
		const { response, visit } = resolveRedirect(domain, host, '/docs', 'GET', zeroLinkVisitCount);

		expect(response.status).toBe(404);
		expect(response.headers.has('location')).toBe(false);
		expect(visit?.outcome).toBe('invalid');
	});

	test('allows fallback to a different local path without graph analysis', () => {
		const domain = preparedDomain({}, preparedResponse({ url: 'https://go.example.test/landing' }));

		expect(
			resolveRedirect(domain, host, '/missing', 'GET', zeroLinkVisitCount).response.headers.get(
				'location'
			)
		).toBe('https://go.example.test/landing');
		expect(
			resolveRedirect(domain, host, '/landing', 'GET', zeroLinkVisitCount).response.status
		).toBe(404);
	});
});
