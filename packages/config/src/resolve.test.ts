import { describe, expect, it } from 'vitest';
import { configurationInput } from '../test/configuration.js';
import { ConfigError } from './errors.js';
import { validateConfig } from './load.js';

const options = { env: {} };
const redirectHost = 'go.example.test';

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
		{ host: 'GO.EXAMPLE.TEST:8443', path: '/', url: 'https://go.example.test:8443/' },
		{ host: 'go.example.test:80', path: '/docs', url: 'http://go.example.test:80/docs' },
		{ host: 'GO.EXAMPLE.TEST', path: '/docs', url: 'http://go.example.test:80/docs' },
		{ host: redirectHost, path: '/docs', url: 'https:///go.example.test/docs' }
	])('rejects $host $path -> $url with ConfigError', ({ host, path, url }) => {
		const input = configurationInput();

		expect(() =>
			validateConfig({ ...input, domains: { [host]: { links: { [path]: { url } } } } }, options)
		).toThrowError(new ConfigError());
	});

	it('keeps errors generic even for disabled links', () => {
		const input = configurationInput();
		const url = 'https://go.example.test/docs?private=dummy-value';

		expect(() =>
			validateConfig(
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
		const { domains } = validateConfig(
			{ ...input, domains: { [redirectHost]: { links: { '/docs': { url } } } } },
			options
		);

		expect(domains[redirectHost]?.links['/docs']?.url).toBe(url);
	});

	it('allows local fallback URLs without graph analysis', () => {
		const input = configurationInput();
		const fallback = 'https://go.example.test/landing';
		const { domains } = validateConfig(
			{
				...input,
				domains: { [redirectHost]: { defaults: { fallback }, links: {} } }
			},
			options
		);

		expect(domains[redirectHost]?.fallback).toBe(fallback);
	});
});

describe('effective domains', () => {
	it('keeps omissions in configuration and records built-in defaults separately', () => {
		const { configuration, domains } = validateConfig(configurationInput(), options);
		expect(configuration.domains['go.example.com']).toEqual({
			defaults: {},
			links: { '/docs': { url: 'https://example.com/docs', tags: [], enabled: true } }
		});
		expect(domains['go.example.com']).toEqual({
			fallback: 404,
			provenance: { fallback: 'builtin' },
			links: {
				'/docs': {
					url: 'https://example.com/docs',
					title: '/docs',
					tags: [],
					enabled: true,
					status_code: 302,
					forward_query: false,
					provenance: { status_code: 'builtin', forward_query: 'builtin' }
				}
			}
		});
		expect(configuration.auth).not.toHaveProperty('secret');
	});

	it('resolves global, domain and link overrides, including explicit false', () => {
		const input = configurationInput({
			'/inherit': { url: 'https://example.com' },
			'/override': { url: 'https://example.com', status_code: 308, forward_query: false }
		});
		const { domains } = validateConfig(
			{
				...input,
				defaults: { status_code: 301, forward_query: true, fallback: 'https://example.com' },
				domains: {
					global: input.domains['go.example.com'],
					domain: {
						defaults: { status_code: 307, forward_query: false, fallback: 404 },
						links: input.domains['go.example.com'].links
					}
				}
			},
			options
		);
		expect(domains.global?.links['/inherit']).toMatchObject({
			status_code: 301,
			forward_query: true,
			provenance: { status_code: 'global', forward_query: 'global' }
		});
		expect(domains.global?.links['/override']).toMatchObject({
			forward_query: false,
			provenance: { forward_query: 'link' }
		});
		expect(domains.global).toMatchObject({
			fallback: 'https://example.com',
			provenance: { fallback: 'global' }
		});
		expect(domains.domain?.links['/inherit']).toMatchObject({
			status_code: 307,
			forward_query: false,
			provenance: { status_code: 'domain', forward_query: 'domain' }
		});
		expect(domains.domain).toMatchObject({ fallback: 404, provenance: { fallback: 'domain' } });
		expect(domains.domain?.links['/override']).toMatchObject({
			status_code: 308,
			forward_query: false,
			provenance: { status_code: 'link', forward_query: 'link' }
		});
		expect(domains.domain?.links['/override']).not.toHaveProperty('fallback');
	});

	it('normalizes domain identities while keeping their path namespaces independent', () => {
		const input = configurationInput();
		const { domains } = validateConfig(
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
			validateConfig({ ...input, domains: { [first]: domain, [second]: domain } }, options)
		).toThrow(ConfigError);
	});

	it.each(['2027-02-30T00:00:00Z', '2027-02-29T00:00:00Z'])(
		'rejects impossible calendar boundaries %s',
		(instant) => {
			for (const field of ['valid_from', 'valid_until']) {
				expect(() =>
					validateConfig(
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
			const { domains } = validateConfig(
				configurationInput({ '/docs': { url: 'https://example.com', valid_from: instant } }),
				options
			);
			expect(domains['go.example.com']?.links['/docs']?.valid_from).toBe(instant);
		}
	);

	it('rejects the admin host, noncanonical paths and reversed or empty validity windows', () => {
		const input = configurationInput();
		expect(() =>
			validateConfig({ ...input, url: { app: 'https://go.example.com' } }, options)
		).toThrow(ConfigError);
		expect(() =>
			validateConfig(configurationInput({ '/docs/': { url: 'https://example.com' } }), options)
		).toThrow(ConfigError);
		for (const end of ['2027-01-01T00:00:00Z', '2026-12-31T23:59:59Z']) {
			expect(() =>
				validateConfig(
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
