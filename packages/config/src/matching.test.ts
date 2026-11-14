import { describe, expect, it } from 'vitest';
import { configurationInput } from '../test/configuration.js';
import { isSelfRedirect, matchLink, validateConfig } from './index.js';

function prepareDomain(links: Parameters<typeof configurationInput>[0]) {
	return validateConfig(configurationInput(links), { env: {} }).domains['go.example.com']!;
}

const destination = 'https://destination.example/base';

describe('named link matching', () => {
	it('preserves YAML identity with ASCII case aliases and one optional final slash', () => {
		const domain = prepareDomain({
			'/Docs': { url: destination },
			'/café': { url: destination },
			'/literal%2Ftext': { url: destination }
		});
		expect(matchLink(domain, '/Docs')).toEqual({ path: '/Docs', suffix: '' });
		expect(matchLink(domain, '/DOCS/')).toEqual({ path: '/Docs', suffix: '' });
		expect(matchLink(domain, '/CAFé')).toEqual({ path: '/café', suffix: '' });
		expect(matchLink(domain, '/CAFÉ')).toBeUndefined();
		expect(matchLink(domain, '/literal%2Ftext')).toEqual({
			path: '/literal%2Ftext',
			suffix: ''
		});
		expect(matchLink(domain, '/literal/text')).toBeUndefined();
		expect(matchLink(domain, '/Docs/install')).toBeUndefined();
		expect(matchLink(domain, '/')).toBeUndefined();
	});

	it('honors explicit case and slash opt-outs even when forwarding paths', () => {
		const domain = prepareDomain({
			'/Docs': {
				url: destination,
				case_insensitive: false,
				ignore_trailing_slash: false,
				forward_path: true
			}
		});
		expect(matchLink(domain, '/Docs')).toEqual({ path: '/Docs', suffix: '' });
		expect(matchLink(domain, '/docs')).toBeUndefined();
		expect(matchLink(domain, '/Docs/')).toBeUndefined();
		expect(matchLink(domain, '/Docs///')).toBeUndefined();
		expect(matchLink(domain, '/Docs/Install/')).toEqual({
			path: '/Docs',
			suffix: '/Install/'
		});
	});

	it('prefers exact identities, then the longest forwarding segment prefix', () => {
		const domain = prepareDomain({
			'/Docs': { url: destination, forward_path: true },
			'/docs/API': { url: destination, forward_path: true },
			'/docs/API/install': { url: destination }
		});
		expect(matchLink(domain, '/DOCS/api/INSTALL/')).toEqual({
			path: '/docs/API/install',
			suffix: ''
		});
		expect(matchLink(domain, '/DOCS/api/Guide/')).toEqual({
			path: '/docs/API',
			suffix: '/Guide/'
		});
		expect(matchLink(domain, '/Docs/API/install/More')).toEqual({
			path: '/docs/API',
			suffix: '/install/More'
		});
		expect(matchLink(domain, '/Docsmith')).toBeUndefined();
	});

	it('selects inactive links without falling through to a parent', () => {
		const domain = prepareDomain({
			'/docs': { url: destination, forward_path: true },
			'/docs/private': {
				url: destination,
				forward_path: true,
				enabled: false,
				valid_from: '2099-01-01T00:00:00Z'
			}
		});
		expect(matchLink(domain, '/DOCS/PRIVATE')).toEqual({
			path: '/docs/private',
			suffix: ''
		});
		expect(matchLink(domain, '/docs/private/Guide')).toEqual({
			path: '/docs/private',
			suffix: '/Guide'
		});
	});

	it('preserves suffix case and slashes without treating empty segments as extra paths', () => {
		const domain = prepareDomain({ '/docs': { url: destination, forward_path: true } });
		expect(matchLink(domain, '/docs/')).toEqual({ path: '/docs', suffix: '' });
		expect(matchLink(domain, '/docs//')).toBeUndefined();
		expect(matchLink(domain, '/docs//Install/')).toEqual({
			path: '/docs',
			suffix: '//Install/'
		});
		expect(matchLink(domain, '/docs/%2E%2E/Next')).toEqual({
			path: '/docs',
			suffix: '/%2E%2E/Next'
		});
	});

	it.each([
		'/docs/.',
		'/docs/../private',
		'/docs/./a',
		'/docs/a\\b',
		'/docs/a\u0000b',
		'/docs/a\u007fb'
	])('does not prefix-serve dangerous decoded path %j', (path) => {
		const domain = prepareDomain({ '/docs': { url: destination, forward_path: true } });
		expect(matchLink(domain, path)).toBeUndefined();
	});

	it('accepts a readonly matching subset for matching and direct self-loop checks', () => {
		const domain = {
			links: {
				'/Docs': {
					case_insensitive: true,
					ignore_trailing_slash: true,
					forward_path: true
				}
			},
			caseInsensitivePaths: { '/docs': '/Docs' }
		} as const;
		expect(matchLink(domain, '/DOCS/Guide')).toEqual({ path: '/Docs', suffix: '/Guide' });
		expect(
			isSelfRedirect('https://go.example.com/DOCS/Guide', 'go.example.com', '/Docs', domain)
		).toBe(true);
		expect(isSelfRedirect('https://go.example.com/DOCS/Guide', 'go.example.com', '/Docs')).toBe(
			false
		);
		expect(isSelfRedirect('https://go.example.com/DOCS', 'go.example.com', '/', domain)).toBe(
			false
		);
	});
});
