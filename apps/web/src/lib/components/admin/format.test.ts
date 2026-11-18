import { expect, test } from 'vitest';
import { formatLastVisit, formatLastVisitCompact, formatUtc } from './format.js';

test('formats detail timestamps in UTC with seconds', () => {
	expect(formatUtc('2026-11-06T22:03:48Z')).toBe('Nov 6, 2026, 22:03:48');
	expect(formatUtc('2026-11-06T17:03:48-05:00')).toBe('Nov 6, 2026, 22:03:48');
});

test('formats the last visit time in UTC', () => {
	const lastActivityAt = Date.parse('2026-11-06T22:03:00Z');
	expect(formatLastVisit(lastActivityAt)).toBe('Nov 6, 2026, 10:03 PM');
	expect(formatLastVisit(null)).toBe('');
	expect(formatLastVisitCompact(lastActivityAt)).toBe('11/6/26, 22:03');
	expect(formatLastVisitCompact(null)).toBe('');
});
