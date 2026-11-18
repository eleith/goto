import type { Visit } from '@goto/db';
import { expect, test } from 'vitest';
import { getVisitFacts } from './visit-facts.js';

const visit: Visit = {
	id: 1,
	processed: 0,
	domain: 'go.example.test',
	path: '/docs',
	outcome: 'valid',
	visited_at: Date.parse('2026-11-16T23:30:00-02:00'),
	ip: '127.0.0.1',
	user_agent: null,
	accept_language: 'en-US,en,fr;q=0.9',
	browser: 'Firefox',
	os: 'Linux'
};

test('interprets shared visit facts without changing raw outcomes or classified families', () => {
	expect(getVisitFacts(visit)).toEqual({
		domain: 'go.example.test',
		path: '/docs',
		outcome: 'valid',
		day: '2026-11-17',
		visitedAt: visit.visited_at,
		browser: 'Firefox',
		operatingSystem: 'Linux',
		languages: ['en', 'fr']
	});
	const root: Visit = {
		...visit,
		path: '/',
		outcome: 'invalid',
		browser: 'Other',
		os: 'Other',
		accept_language: null
	};
	expect(getVisitFacts(root)).toEqual({
		domain: 'go.example.test',
		path: '/',
		outcome: 'valid',
		day: '2026-11-17',
		visitedAt: visit.visited_at,
		browser: 'Other',
		operatingSystem: 'Other',
		languages: ['Other']
	});
	expect(root.outcome).toBe('invalid');
	expect(getVisitFacts({ ...visit, outcome: 'invalid' }).outcome).toBe('invalid');
});
