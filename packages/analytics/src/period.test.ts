import { expect, test } from 'vitest';
import { createVisitPeriod, visitDays } from './period.js';

test('period subtraction clamps UTC month ends and preserves time of day', () => {
	expect(createVisitPeriod(3, Date.UTC(2024, 4, 31, 12, 34, 56, 789))).toEqual({
		from: '2024-02-29T12:34:56.789Z',
		asOf: '2024-05-31T12:34:56.789Z',
		timezone: 'UTC',
		retentionMonths: 3
	});
	expect(createVisitPeriod(9, Date.UTC(2026, 0, 31)).from).toBe('2025-04-30T00:00:00.000Z');
	expect(createVisitPeriod(12, Date.UTC(2024, 1, 29)).from).toBe('2023-02-28T00:00:00.000Z');
});

test('daily points cover the full window in UTC with partial edge days', () => {
	const period = createVisitPeriod(3, Date.UTC(2026, 4, 31, 12));
	const days = visitDays(period);

	expect(days[0]).toEqual({
		start: '2026-02-28T00:00:00.000Z',
		end: '2026-03-01T00:00:00.000Z',
		partial: true
	});
	expect(days.at(-1)).toEqual({
		start: '2026-05-31T00:00:00.000Z',
		end: '2026-06-01T00:00:00.000Z',
		partial: true
	});
	expect(days.slice(1, -1).every((day) => !day.partial)).toBe(true);
	for (let index = 1; index < days.length; index++) {
		expect(days[index]?.start).toBe(days[index - 1]?.end);
	}
});

test('midnight cutoff omits the following day and leaves full days unmarked', () => {
	const days = visitDays(createVisitPeriod(3, Date.UTC(2026, 3, 1)));

	expect(days).toHaveLength(90);
	expect(days[0]?.start).toBe('2026-01-01T00:00:00.000Z');
	expect(days.at(-1)?.end).toBe('2026-04-01T00:00:00.000Z');
	expect(days.every((day) => !day.partial)).toBe(true);
});

test('period helpers reject invalid instants instead of normalizing dates silently', () => {
	expect(() => createVisitPeriod(3, Number.NaN)).toThrow('Invalid analytics period');
	const period = createVisitPeriod(3, Date.UTC(2026, 3, 1));
	expect(() => visitDays({ ...period, from: '2026-02-30T00:00:00.000Z' })).toThrow(
		'Invalid analytics period'
	);
	expect(() => visitDays({ ...period, from: period.asOf })).toThrow('Invalid analytics period');
});
