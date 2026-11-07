import { expect, test } from 'vitest';
import { formatUpdated, formatRetention } from './format.js';

test('formats the snapshot update time in UTC', () => {
	const updatedAt = Date.parse('2026-11-06T22:03:00Z');
	expect(formatUpdated(updatedAt)).toBe('Updated Nov 6, 2026, 10:03 PM UTC');
	expect(formatUpdated(null)).toBe('');
});

test('shows the configured retention policy rather than an elapsed day count', () => {
	expect(formatRetention(3)).toBe('3 months');
	expect(formatRetention(0)).toBe('Off');
});
