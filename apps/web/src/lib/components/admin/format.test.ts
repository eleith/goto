import { expect, test } from 'vitest';
import { formatUpdated, formatUpdatedCompact } from './format.js';

test('formats the snapshot update time in UTC', () => {
	const updatedAt = Date.parse('2026-11-06T22:03:00Z');
	expect(formatUpdated(updatedAt)).toBe('Updated Nov 6, 2026, 10:03 PM UTC');
	expect(formatUpdated(null)).toBe('');
	expect(formatUpdatedCompact(updatedAt)).toBe('Updated 11/6/26, 22:03 UTC');
	expect(formatUpdatedCompact(null)).toBe('');
});
