import { expect, test } from 'vitest';
import { retentionCutoff } from './retention.js';

test('uses UTC calendar months, clamping the day while preserving the time', () => {
	const now = Date.parse('2026-05-31T12:34:56.789Z');
	expect(new Date(retentionCutoff(3, now)).toISOString()).toBe('2026-02-28T12:34:56.789Z');
	expect(new Date(retentionCutoff(9, now)).toISOString()).toBe('2025-08-31T12:34:56.789Z');
	expect(new Date(retentionCutoff(12, now)).toISOString()).toBe('2025-05-31T12:34:56.789Z');
});

test('handles leap-day boundaries without overflowing into March', () => {
	expect(new Date(retentionCutoff(3, Date.parse('2024-05-31T01:00:00Z'))).toISOString()).toBe(
		'2024-02-29T01:00:00.000Z'
	);
	expect(new Date(retentionCutoff(12, Date.parse('2024-02-29T01:00:00Z'))).toISOString()).toBe(
		'2023-02-28T01:00:00.000Z'
	);
});
