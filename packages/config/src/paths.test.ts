import { describe, expect, it } from 'vitest';
import { isCanonicalPath } from './paths.js';

describe('logical YAML paths', () => {
	it.each(['/', '/docs', '/a/b', '/a//b', '/日本語/🚀', '/literal%2Ftext', '/100%', '/a*b'])(
		'accepts %s without decoding or rewriting it',
		(path) => {
			expect(isCanonicalPath(path)).toBe(true);
		}
	);

	it.each([
		'',
		'docs',
		'//docs',
		'/docs/',
		'/a/./b',
		'/a/../b',
		'/.',
		'/..',
		'/a b',
		'/a\tb',
		'/a\nb',
		'/a\u0000b',
		'/a\u007fb',
		'/a\\b',
		'/a:b',
		'/a?b',
		'/a#b',
		'/a[b',
		'/a]b',
		'/a@b'
	])('rejects noncanonical path %j rather than repairing it', (path) => {
		expect(isCanonicalPath(path)).toBe(false);
	});
});
