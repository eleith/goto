import { loadConfig } from '@goto/config';
import { expect, test } from 'vitest';
import { currentLinkState } from './link-state.js';

function limitedLink() {
	return loadConfig(
		{
			auth: { credentials: { username: 'example', password: 'unit-only-password' } },
			domains: {
				'go.example.test': {
					links: { '/docs': { url: 'https://example.org/docs', max_visits: 2 } }
				}
			}
		},
		{ env: {} }
	).domains['go.example.test']!.links['/docs']!;
}

test('disabled and date states take precedence over exhaustion', () => {
	const link = limitedLink();
	link.valid_from = '2030-01-01T00:00:00Z';
	link.valid_until = '2030-01-02T00:00:00Z';
	const start = Date.parse(link.valid_from);
	const end = Date.parse(link.valid_until);

	link.enabled = false;
	expect(currentLinkState(link, start - 1, 2)).toBe('disabled');
	link.enabled = true;
	expect(currentLinkState(link, start - 1, 2)).toBe('scheduled');
	expect(currentLinkState(link, start, 1)).toBe('active');
	expect(currentLinkState(link, end - 1, 2)).toBe('exhausted');
	expect(currentLinkState(link, end, 2)).toBe('expired');
});

test('an active link is exhausted at or above its limit and remains active without a limit', () => {
	const link = limitedLink();
	expect(currentLinkState(link, 0, 2)).toBe('exhausted');
	expect(currentLinkState(link, 0, 3)).toBe('exhausted');
	delete link.max_visits;
	expect(currentLinkState(link, 0, 3)).toBe('active');
});
