import { describe, expect, it } from 'vitest';
import { configurationInput } from '../test/configuration.js';
import { ConfigError } from './errors.js';
import { validateConfig } from './load.js';

const options = { env: {} };

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
					'OTHER.example:0443': { links: { '/docs': { url: 'https://other.example/docs' } } }
				}
			},
			options
		);
		expect(Object.keys(domains)).toEqual(['xn--bcher-kva.example:8443', 'other.example']);
		expect(domains['xn--bcher-kva.example:8443']?.links['/docs']?.url).toBe(
			'https://example.com/docs'
		);
		expect(domains['other.example']?.links['/docs']?.url).toBe('https://other.example/docs');
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
				).toThrowError(new ConfigError());
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
			validateConfig({ ...input, site: { url: 'https://go.example.com' } }, options)
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
