import { validateConfig } from '@goto/config';
import { expect, test } from 'vitest';
import { prepareSnapshot } from '../snapshot.js';
import { currentTags, tagMembers } from './inventory.js';

test('uses exact current labels across domains, once per named link regardless of state', () => {
	const snapshot = prepareSnapshot(
		validateConfig(
			{
				auth: { credentials: { username: 'test', password: 'tag-inventory-test-password' } },
				domains: {
					'go.example.test': {
						root: { url: 'https://example.test/start' },
						links: {
							'/docs': {
								url: 'https://example.test/docs',
								tags: ['Work', 'Work', 'work', ' Work ']
							},
							'/later': {
								url: 'https://example.test/later',
								tags: ['Work'],
								valid_from: '2099-01-01T00:00:00Z'
							}
						}
					},
					'other.example.test': {
						links: {
							'/docs': {
								url: 'https://example.test/other',
								tags: ['Work', 'Work/100%é'],
								enabled: false
							},
							'/old': {
								url: 'https://example.test/old',
								tags: ['Work'],
								valid_until: '2020-01-01T00:00:00Z'
							}
						}
					}
				}
			},
			{ env: {} }
		)
	);

	expect(currentTags(snapshot.domains)).toEqual([' Work ', 'Work', 'Work/100%é', 'work']);
	const members = tagMembers(snapshot.domains, 'Work');
	expect(members.map(({ domain, path }) => ({ domain, path }))).toEqual([
		{ domain: 'go.example.test', path: '/docs' },
		{ domain: 'go.example.test', path: '/later' },
		{ domain: 'other.example.test', path: '/docs' },
		{ domain: 'other.example.test', path: '/old' }
	]);
	expect(members[0]?.link).toBe(snapshot.domains['go.example.test']?.links['/docs']);
	expect(tagMembers(snapshot.domains, ' Work ').map(({ path }) => path)).toEqual(['/docs']);
	expect(tagMembers(snapshot.domains, 'WORK')).toEqual([]);
});
