import { validateConfig } from '@goto/config';
import { expect, test } from 'vitest';
import { prepareSnapshot } from './snapshot.js';

test('publishes a deep-frozen copy without changing the loaded configuration', () => {
	const prepared = validateConfig(
		{
			auth: { credentials: { username: 'example', password: 'test-only-password' } },
			link_defaults: { forward_query: true },
			fallback: { url: 'https://example.org/missing' },
			domains: {
				'go.example.test': {
					root: { url: 'https://example.org/start' },
					links: {
						'/docs': { url: 'https://example.org/docs', tags: ['work'], forward_query: false }
					}
				}
			}
		},
		{ env: {} }
	);
	const snapshot = prepareSnapshot(prepared);
	const link = snapshot.domains['go.example.test']!.links['/docs']!;

	expect(snapshot).toEqual(prepared);
	expect(snapshot).not.toBe(prepared);
	expect(Object.isFrozen(snapshot)).toBe(true);
	expect(Object.isFrozen(snapshot.configuration.auth)).toBe(true);
	expect(Object.isFrozen(snapshot.domains['go.example.test']!.root)).toBe(true);
	expect(Object.isFrozen(snapshot.domains['go.example.test']!.fallback)).toBe(true);
	expect(Object.isFrozen(link.tags)).toBe(true);
	expect(Object.isFrozen(snapshot.domains['go.example.test']!.caseInsensitivePaths)).toBe(true);
	expect(
		Reflect.set(snapshot.domains['go.example.test']!.caseInsensitivePaths, '/docs', '/other')
	).toBe(false);
	expect(Reflect.set(link, 'enabled', false)).toBe(false);
	expect(link.forward_query).toBe(false);
	expect(link.provenance.forward_query).toBe('link');
	prepared.domains['go.example.test']!.links['/docs']!.tags.push('changed');
	expect(link.tags).toEqual(['work']);
	expect(Object.isFrozen(prepared)).toBe(false);
});
