import { describe, expect, it } from 'vitest';
import { configurationInput } from '../test/configuration.js';
import { ConfigError } from './errors.js';
import { loadConfig } from './load.js';

const options = { env: {} };
const redirectHost = 'go.example.test';

it('allows @ in links outside the reserved /@static/ prefix', () => {
	const destination = { url: 'https://example.com/destination' };
	const { domains } = loadConfig(
		configurationInput({ '/@alice': destination, '/@static': destination }),
		options
	);
	expect(Object.keys(domains['go.example.com']!.links)).toEqual(['/@alice', '/@static']);
	for (const path of ['/@static/favicon.svg', '/@static/notes']) {
		expect(() => loadConfig(configurationInput({ [path]: destination }), options)).toThrow(
			ConfigError
		);
	}
});

describe('direct self-loop validation', () => {
	it.each([
		{
			host: redirectHost,
			path: '/docs',
			url: 'https://GO.EXAMPLE.TEST:443/docs?changed=one#fragment'
		},
		{ host: redirectHost, path: '/docs', url: 'http://go.example.test/%64ocs' },
		{ host: redirectHost, path: '/a/b', url: 'https://go.example.test/a%2Fb' },
		{ host: redirectHost, path: '/a%2Fb', url: 'https://go.example.test/a%252Fb' },
		{ host: 'go.example.test:80', path: '/docs', url: 'http://go.example.test:80/docs' },
		{ host: 'GO.EXAMPLE.TEST', path: '/docs', url: 'http://go.example.test:80/docs' },
		{ host: redirectHost, path: '/docs', url: 'https:///go.example.test/docs' }
	])('rejects $host $path -> $url with ConfigError', ({ host, path, url }) => {
		const input = configurationInput();

		expect(() =>
			loadConfig({ ...input, domains: { [host]: { links: { [path]: { url } } } } }, options)
		).toThrowError(new ConfigError());
	});

	it('rejects a direct root self-loop and allows a different path on the same domain', () => {
		const input = configurationInput();
		expect(() =>
			loadConfig(
				{
					...input,
					domains: {
						'GO.EXAMPLE.TEST:8443': {
							root: { url: 'https://go.example.test:8443/?private=dummy-value#fragment' },
							links: {}
						}
					}
				},
				options
			)
		).toThrowError(new ConfigError());
		const { domains } = loadConfig(
			{
				...input,
				domains: {
					[redirectHost]: { root: { url: 'https://go.example.test/landing' }, links: {} }
				}
			},
			options
		);
		expect(domains[redirectHost]?.root?.url).toBe('https://go.example.test/landing');
	});

	it('keeps errors generic even for disabled links', () => {
		const input = configurationInput();
		const url = 'https://go.example.test/docs?private=dummy-value';

		expect(() =>
			loadConfig(
				{ ...input, domains: { [redirectHost]: { links: { '/docs': { url, enabled: false } } } } },
				options
			)
		).toThrowError(new ConfigError());
	});

	it.each([
		'https://other.example.test/docs',
		'https://go.example.test:8443/docs',
		'https://go.example.test/Docs',
		'https://go.example.test/docs/',
		'https://go.example.test/docs/extra',
		'https://go.example.test/%2564ocs',
		'https://go.example.test/%FF',
		'https:///other.example.test/docs',
		'http://OTHER.example.test:80/p%61th?owned=%2f#fragment'
	])('preserves distinct authored destinations: %s', (url) => {
		const input = configurationInput();
		const { domains } = loadConfig(
			{
				...input,
				domains: {
					[redirectHost]: {
						links: {
							'/docs': { url, case_insensitive: false, ignore_trailing_slash: false }
						}
					}
				}
			},
			options
		);

		expect(domains[redirectHost]?.links['/docs']?.url).toBe(url);
	});

	it.each(['/DOCS', '/docs/', '/DOCS/Install'])(
		'rejects a destination matching the same link: %s',
		(path) => {
			expect(() =>
				loadConfig(
					{
						...configurationInput(),
						domains: {
							[redirectHost]: {
								links: {
									'/docs': {
										url: `https://${redirectHost}${path}?changed=one#fragment`,
										forward_path: true,
										enabled: false
									}
								}
							}
						}
					},
					options
				)
			).toThrowError(new ConfigError());
		}
	);

	it('rejects self-looping targets even in a disabled link and a shadowed rule', () => {
		expect(() =>
			loadConfig(
				{
					...configurationInput(),
					domains: {
						[redirectHost]: {
							links: {
								'/docs': {
									url: 'https://destination.example/docs',
									enabled: false,
									forward_path: true,
									redirect: [
										{ if: { language: 'fr' }, to: 'https://destination.example/fr' },
										{ if: { language: 'fr' }, to: `https://${redirectHost}/DOCS/Install` }
									]
								}
							}
						}
					}
				},
				options
			)
		).toThrowError(new ConfigError());
	});

	it('uses all prepared links to distinguish destination identity from its parent prefix', () => {
		const { domains } = loadConfig(
			{
				...configurationInput(),
				domains: {
					[redirectHost]: {
						links: {
							'/docs': {
								url: `https://${redirectHost}/DOCS/API/`,
								forward_path: true,
								redirect: [{ if: { os: 'ios' }, to: `https://${redirectHost}/DOCS/API/?from=ios` }]
							},
							'/docs/api': { url: 'https://destination.example/api' }
						}
					}
				}
			},
			options
		);
		expect(domains[redirectHost]?.links['/docs']?.url).toBe(`https://${redirectHost}/DOCS/API/`);
		expect(domains[redirectHost]?.links['/docs']?.redirect).toEqual([
			{ if: { os: 'ios' }, to: `https://${redirectHost}/DOCS/API/?from=ios` }
		]);
	});

	it('allows local fallback URLs without graph analysis', () => {
		const input = configurationInput();
		const fallback = { url: 'https://go.example.test/landing' };
		const { domains } = loadConfig(
			{
				...input,
				domains: { [redirectHost]: { fallback, links: {} } }
			},
			options
		);

		expect(domains[redirectHost]?.fallback).toEqual({
			...fallback,
			status_code: 302,
			forward_query: false
		});
	});
});

describe('effective domains', () => {
	it('carries a named-link visit limit without defaulting unlimited sibling links', () => {
		const input = configurationInput({
			'/limited': { url: 'https://example.com/limited', max_visits: 42 },
			'/unlimited': { url: 'https://example.com/unlimited' }
		});
		const original = structuredClone(input);
		const { configuration, domains } = loadConfig(input, options);
		expect(configuration.domains['go.example.com']?.links['/limited']?.max_visits).toBe(42);
		expect(domains['go.example.com']?.links['/limited']?.max_visits).toBe(42);
		expect(configuration.domains['go.example.com']?.links['/unlimited']).not.toHaveProperty(
			'max_visits'
		);
		expect(domains['go.example.com']?.links['/unlimited']).not.toHaveProperty('max_visits');
		expect(input).toEqual(original);
	});

	it('normalizes prepared language conditions without changing authored rules or adding conditions', () => {
		const input = configurationInput({
			'/docs': {
				url: 'https://example.com/docs',
				redirect: [
					{ if: { language: 'FR-ca', os: 'ios' }, to: 'https://example.com/fr-ios' },
					{ if: { os: 'linux' }, to: 'https://example.com/linux' },
					{ if: { language: 'EN' }, to: 'https://example.com/en' }
				]
			}
		});
		const original = structuredClone(input);
		const { configuration, domains } = loadConfig(input, options);
		expect(domains['go.example.com']?.links['/docs']?.redirect).toEqual([
			{ if: { language: 'fr-ca', os: 'ios' }, to: 'https://example.com/fr-ios' },
			{ if: { os: 'linux' }, to: 'https://example.com/linux' },
			{ if: { language: 'en' }, to: 'https://example.com/en' }
		]);
		expect(configuration.domains['go.example.com']?.links['/docs']?.redirect).toEqual(
			original.domains['go.example.com'].links['/docs']?.redirect
		);
		expect(input).toEqual(original);
	});

	it('keeps omissions in configuration and records built-in defaults separately', () => {
		const { configuration, domains } = loadConfig(configurationInput(), options);
		expect(configuration.domains['go.example.com']).toEqual({
			link_defaults: {},
			links: { '/docs': { url: 'https://example.com/docs', tags: [], enabled: true } }
		});
		expect(domains['go.example.com']).toEqual({
			root: null,
			fallback: null,
			provenance: { fallback: 'builtin' },
			caseInsensitivePaths: { '/docs': '/docs' },
			links: {
				'/docs': {
					url: 'https://example.com/docs',
					title: '/docs',
					tags: [],
					enabled: true,
					status_code: 302,
					forward_query: false,
					case_insensitive: true,
					ignore_trailing_slash: true,
					forward_path: false,
					provenance: {
						status_code: 'builtin',
						forward_query: 'builtin',
						case_insensitive: 'builtin',
						ignore_trailing_slash: 'builtin',
						forward_path: 'builtin'
					}
				}
			}
		});
		expect(configuration.auth).not.toHaveProperty('secret');
		expect(configuration).not.toHaveProperty('fallback');
		expect(configuration.domains['go.example.com']).not.toHaveProperty('root');
		expect(configuration.domains['go.example.com']).not.toHaveProperty('fallback');
	});

	it('records explicit global false matching defaults instead of treating them as omissions', () => {
		const { configuration, domains } = loadConfig(
			{
				...configurationInput(),
				link_defaults: {
					case_insensitive: false,
					ignore_trailing_slash: false,
					forward_path: false
				}
			},
			options
		);
		expect(configuration.domains['go.example.com']?.link_defaults).toEqual({});
		expect(domains['go.example.com']?.links['/docs']).toMatchObject({
			case_insensitive: false,
			ignore_trailing_slash: false,
			forward_path: false,
			provenance: {
				case_insensitive: 'global',
				ignore_trailing_slash: 'global',
				forward_path: 'global'
			}
		});
		expect(domains['go.example.com']?.caseInsensitivePaths).toEqual({});
	});

	it('resolves global, domain and link overrides, including explicit false', () => {
		const input = configurationInput({
			'/inherit': { url: 'https://example.com' },
			'/override': {
				url: 'https://example.com',
				status_code: 308,
				forward_query: false,
				case_insensitive: false,
				ignore_trailing_slash: false,
				forward_path: false
			}
		});
		const { domains } = loadConfig(
			{
				...input,
				link_defaults: {
					status_code: 301,
					forward_query: true,
					case_insensitive: true,
					ignore_trailing_slash: true,
					forward_path: true
				},
				fallback: { url: 'https://example.com' },
				domains: {
					global: input.domains['go.example.com'],
					domain: {
						link_defaults: {
							status_code: 307,
							forward_query: false,
							case_insensitive: false,
							ignore_trailing_slash: false,
							forward_path: false
						},
						fallback: { url: 'https://example.com/domain-missing' },
						links: input.domains['go.example.com'].links
					}
				}
			},
			options
		);
		expect(domains.global?.links['/inherit']).toMatchObject({
			status_code: 301,
			forward_query: true,
			case_insensitive: true,
			ignore_trailing_slash: true,
			forward_path: true,
			provenance: {
				status_code: 'global',
				forward_query: 'global',
				case_insensitive: 'global',
				ignore_trailing_slash: 'global',
				forward_path: 'global'
			}
		});
		expect(domains.global?.links['/override']).toMatchObject({
			forward_query: false,
			case_insensitive: false,
			ignore_trailing_slash: false,
			forward_path: false,
			provenance: {
				forward_query: 'link',
				case_insensitive: 'link',
				ignore_trailing_slash: 'link',
				forward_path: 'link'
			}
		});
		expect(domains.global).toMatchObject({
			fallback: { url: 'https://example.com', status_code: 302, forward_query: false },
			provenance: { fallback: 'global' }
		});
		expect(domains.domain?.links['/inherit']).toMatchObject({
			status_code: 307,
			forward_query: false,
			case_insensitive: false,
			ignore_trailing_slash: false,
			forward_path: false,
			provenance: {
				status_code: 'domain',
				forward_query: 'domain',
				case_insensitive: 'domain',
				ignore_trailing_slash: 'domain',
				forward_path: 'domain'
			}
		});
		expect(domains.domain).toMatchObject({
			fallback: {
				url: 'https://example.com/domain-missing',
				status_code: 302,
				forward_query: false
			},
			provenance: { fallback: 'domain' }
		});
		expect(domains.domain?.links['/override']).toMatchObject({
			status_code: 308,
			forward_query: false,
			case_insensitive: false,
			ignore_trailing_slash: false,
			forward_path: false,
			provenance: {
				status_code: 'link',
				forward_query: 'link',
				case_insensitive: 'link',
				ignore_trailing_slash: 'link',
				forward_path: 'link'
			}
		});
		expect(domains.domain?.links['/override']).not.toHaveProperty('fallback');
	});

	it('replaces a global fallback as a whole and keeps root response options independent', () => {
		const { domains } = loadConfig(
			{
				...configurationInput(),
				link_defaults: { status_code: 308, forward_query: true },
				fallback: { url: 'https://example.com/global', status_code: 307, forward_query: true },
				domains: {
					inherited: { links: {} },
					replaced: {
						root: { url: 'https://example.com/root', status_code: 301, forward_query: true },
						fallback: { url: 'https://example.com/domain' },
						links: {}
					}
				}
			},
			options
		);
		expect(domains.inherited).toEqual({
			root: null,
			fallback: { url: 'https://example.com/global', status_code: 307, forward_query: true },
			provenance: { fallback: 'global' },
			links: {},
			caseInsensitivePaths: {}
		});
		expect(domains.replaced).toEqual({
			root: { url: 'https://example.com/root', status_code: 301, forward_query: true },
			fallback: { url: 'https://example.com/domain', status_code: 302, forward_query: false },
			provenance: { fallback: 'domain' },
			links: {},
			caseInsensitivePaths: {}
		});
	});

	it.each([
		[true, true],
		[true, false],
		[false, true]
	])(
		'rejects overlapping case identities with insensitive flags %s and %s in either order',
		(first, second) => {
			const links = {
				'/Docs': { url: 'https://destination.example/first', case_insensitive: first },
				'/docs': { url: 'https://destination.example/second', case_insensitive: second }
			};
			for (const entries of [Object.entries(links), Object.entries(links).reverse()]) {
				expect(() =>
					loadConfig(configurationInput(Object.fromEntries(entries)), options)
				).toThrowError(new ConfigError());
			}
		}
	);

	it('keeps distinct strict case identities and non-ASCII spelling independent', () => {
		const { domains } = loadConfig(
			configurationInput({
				'/Docs': { url: 'https://destination.example/first', case_insensitive: false },
				'/docs': { url: 'https://destination.example/second', case_insensitive: false },
				'/café': { url: 'https://destination.example/lower' },
				'/CAFÉ': { url: 'https://destination.example/upper' }
			}),
			options
		);
		expect(Object.keys(domains['go.example.com']!.links)).toEqual([
			'/Docs',
			'/docs',
			'/café',
			'/CAFÉ'
		]);
		expect(domains['go.example.com']?.caseInsensitivePaths).toEqual({
			'/café': '/café',
			'/cafÉ': '/CAFÉ'
		});
		expect(Object.getPrototypeOf(domains['go.example.com']!.caseInsensitivePaths)).toBeNull();
	});

	it('rejects the root as a named link', () => {
		expect(() =>
			loadConfig(configurationInput({ '/': { url: 'https://example.com' } }), options)
		).toThrow(ConfigError);
	});

	it('normalizes domain identities while keeping their path namespaces independent', () => {
		const input = configurationInput();
		const { domains } = loadConfig(
			{
				...input,
				domains: {
					'BÜCHER.Example:8443': input.domains['go.example.com'],
					'OTHER.example:0443': { links: { '/docs': { url: 'https://destination.example/docs' } } }
				}
			},
			options
		);
		expect(Object.keys(domains)).toEqual(['xn--bcher-kva.example:8443', 'other.example']);
		expect(domains['xn--bcher-kva.example:8443']?.links['/docs']?.url).toBe(
			'https://example.com/docs'
		);
		expect(domains['other.example']?.links['/docs']?.url).toBe('https://destination.example/docs');
	});

	it.each([
		['GO.example.com', 'go.example.com'],
		['bücher.example', 'xn--bcher-kva.example']
	])('rejects colliding domain spellings %s and %s', (first, second) => {
		const input = configurationInput();
		const domain = input.domains['go.example.com'];
		expect(() =>
			loadConfig({ ...input, domains: { [first]: domain, [second]: domain } }, options)
		).toThrow(ConfigError);
	});

	it.each(['2027-02-30T00:00:00Z', '2027-02-29T00:00:00Z'])(
		'rejects impossible calendar boundaries %s',
		(instant) => {
			for (const field of ['valid_from', 'valid_until']) {
				expect(() =>
					loadConfig(
						configurationInput({ '/docs': { url: 'https://example.com', [field]: instant } }),
						options
					)
				).toThrowError(
					expect.objectContaining({ constructor: ConfigError, message: 'Invalid configuration' })
				);
			}
		}
	);

	it.each(['2028-02-29T00:00:00Z', '2028-02-29T23:30:00-02:00'])(
		'accepts valid leap-day boundaries and timezone offsets %s',
		(instant) => {
			const { domains } = loadConfig(
				configurationInput({ '/docs': { url: 'https://example.com', valid_from: instant } }),
				options
			);
			expect(domains['go.example.com']?.links['/docs']?.valid_from).toBe(instant);
		}
	);

	it('allows the app host to have ordinary short links and an explicit Root', () => {
		const input = configurationInput({ '/administrator': { url: 'https://example.com/docs' } });
		const { domains } = loadConfig(
			{
				...input,
				url: { app: 'https://go.example.com' },
				domains: {
					'GO.example.com': {
						...input.domains['go.example.com'],
						root: { url: 'https://go.example.com/admin' }
					},
					'other.example.com': { links: { '/admin': { url: 'https://example.com' } } }
				}
			},
			options
		);
		expect(domains['go.example.com']?.root?.url).toBe('https://go.example.com/admin');
		expect(domains['go.example.com']?.links['/administrator']?.url).toBe(
			'https://example.com/docs'
		);
		expect(domains['other.example.com']?.links['/admin']?.url).toBe('https://example.com');
	});

	it.each(['/signin/help', '/@vite/client'])(
		'reserves %s on the shared host even for case-sensitive links',
		(path) => {
			const input = configurationInput({
				[path]: { url: 'https://example.com', case_insensitive: false }
			});
			expect(() =>
				loadConfig({ ...input, url: { app: 'https://go.example.com' } }, options)
			).toThrowError(
				expect.objectContaining({
					issues: [
						{ path: '/domains/*/links/*', message: 'Path reserved for the app on the shared host' }
					]
				})
			);
		}
	);

	it('rejects a reserved alias unless the link opts out of its domain default', () => {
		const url = 'https://example.com';
		const input = configurationInput({ '/Admin': { url } });
		const domains = {
			'go.example.com': {
				links: input.domains['go.example.com'].links,
				link_defaults: { case_insensitive: true }
			}
		};
		const shared = {
			...input,
			url: { app: 'https://go.example.com' },
			link_defaults: { case_insensitive: false },
			domains
		};
		expect(() => loadConfig(shared, options)).toThrowError(
			expect.objectContaining({
				issues: [
					{ path: '/domains/*/links/*', message: 'Path reserved for the app on the shared host' }
				]
			})
		);

		domains['go.example.com'].links['/Admin'] = { url, case_insensitive: false };
		const loaded = loadConfig(shared, options);
		expect(loaded.domains['go.example.com']?.links['/Admin']?.url).toBe(url);
	});

	it('rejects noncanonical paths and reversed or empty validity windows', () => {
		expect(() =>
			loadConfig(configurationInput({ '/docs/': { url: 'https://example.com' } }), options)
		).toThrow(ConfigError);
		for (const end of ['2027-01-01T00:00:00Z', '2026-12-31T23:59:59Z']) {
			expect(() =>
				loadConfig(
					configurationInput({
						'/docs': {
							url: 'https://example.com',
							valid_from: '2027-01-01T00:00:00Z',
							valid_until: end
						}
					}),
					options
				)
			).toThrowError(new ConfigError());
		}
	});
});
