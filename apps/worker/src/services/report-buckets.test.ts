import { expect, test } from 'vitest';
import { reportPeriod } from './report-buckets.js';

test('prepares UTC days, Monday weeks and calendar months with honest partial edges', () => {
	const asOf = Date.parse('2026-05-31T12:34:56.789Z');
	const period = reportPeriod(3, asOf);
	expect(period.since).toBe(Date.parse('2026-02-28T12:34:56.789Z'));
	expect(period.asOf).toBe(asOf);
	expect(period.days[0]).toEqual({
		start: Date.parse('2026-02-28T00:00:00Z'),
		end: Date.parse('2026-03-01T00:00:00Z'),
		partial: true
	});
	expect(period.days[1]).toEqual({
		start: Date.parse('2026-03-01T00:00:00Z'),
		end: Date.parse('2026-03-02T00:00:00Z'),
		partial: false
	});
	expect(period.weeks[1]).toEqual({
		start: Date.parse('2026-03-02T00:00:00Z'),
		end: Date.parse('2026-03-09T00:00:00Z'),
		partial: false
	});
	expect(period.months[1]).toEqual({
		start: Date.parse('2026-03-01T00:00:00Z'),
		end: Date.parse('2026-04-01T00:00:00Z'),
		partial: false
	});
	expect(new Date(period.weeks[0]!.start).getUTCDay()).toBe(1);
	expect(period.months[0]!.start).toBe(Date.parse('2026-02-01T00:00:00Z'));
	expect(period.days.at(-1)!.partial).toBe(true);
	expect(period.months.at(-1)!.partial).toBe(true);
});
