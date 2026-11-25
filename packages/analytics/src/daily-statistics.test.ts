import { expect, test } from 'vitest';
import { createVisitPeriod } from './period.js';
import {
	addDailyStatistics,
	canSubtractDailyStatistics,
	checkDailyStatistics,
	emptyDailyStatistics,
	projectVisitDetails,
	subtractDailyStatistics,
	type DailyVisitStatistics
} from './daily-statistics.js';

const scope = { kind: 'domain', domain: 'go.example.test' } as const;
const day = '2026-04-01';
const period = createVisitPeriod(3, Date.UTC(2026, 3, 1, 12));

function contribution(
	validVisits: number,
	invalidVisits: number,
	hour: number
): DailyVisitStatistics {
	const counts = { validVisits, invalidVisits };
	return {
		...emptyDailyStatistics(scope, day),
		...counts,
		lastVisitAt: Date.UTC(2026, 3, 1, hour),
		browsers: [{ name: 'Other', ...counts }],
		operatingSystems: [{ name: 'Linux', ...counts }],
		acceptedLanguages: [
			{ name: 'en', ...counts },
			{ name: 'fr', ...counts }
		]
	};
}

test('daily addition and subtraction preserve outcomes and overlapping language memberships without mutating input', () => {
	const old = contribution(2, 1, 1);
	const recent = contribution(1, 0, 10);
	const before = structuredClone([old, recent]);
	expect(addDailyStatistics(null, old)).toEqual(old);
	const empty = emptyDailyStatistics(scope, day);
	expect(addDailyStatistics(null, empty)).toEqual(empty);
	const merged = addDailyStatistics(old, recent);
	expect(merged).toMatchObject({
		validVisits: 3,
		invalidVisits: 1,
		lastVisitAt: recent.lastVisitAt
	});
	expect(merged.acceptedLanguages).toEqual([
		{ name: 'en', validVisits: 3, invalidVisits: 1 },
		{ name: 'fr', validVisits: 3, invalidVisits: 1 }
	]);
	expect(canSubtractDailyStatistics(merged, old)).toBe(true);
	const retained = subtractDailyStatistics(merged, old)!;
	expect(retained).toEqual(recent);
	expect(subtractDailyStatistics(retained, recent)).toBeNull();
	expect(canSubtractDailyStatistics(recent, old)).toBe(false);
	expect(() => subtractDailyStatistics(recent, old)).toThrow(/^Invalid analytics report$/);
	expect([old, recent]).toEqual(before);
});

test('projection uses the explicit current period, fills missing dates, and exposes event activity in v5', () => {
	const visible = contribution(2, 1, 10);
	const outside = {
		...contribution(1, 0, 1),
		day: '2025-12-31',
		lastVisitAt: Date.UTC(2025, 11, 31, 1)
	};
	const details = projectVisitDetails(scope, period, [outside, visible]);
	expect(details.version).toBe(5);
	expect(details.lastActivityAt).toBe('2026-04-01T10:00:00.000Z');
	expect(details.daily[0]?.start).toBe('2026-01-01T00:00:00.000Z');
	expect(details.daily).not.toContainEqual(
		expect.objectContaining({ start: '2025-12-31T00:00:00.000Z' })
	);
	expect(details.daily.at(-2)).toMatchObject({
		start: '2026-03-31T00:00:00.000Z',
		validVisits: 0,
		invalidVisits: 0
	});
	expect(details.daily.at(-1)).toMatchObject({
		start: '2026-04-01T00:00:00.000Z',
		validVisits: 2,
		invalidVisits: 1
	});
	expect(details.browsers).toEqual([{ day, name: 'Other', validVisits: 2, invalidVisits: 1 }]);
	expect(details.acceptedLanguages).toEqual(
		visible.acceptedLanguages.map((row) => ({ day, ...row }))
	);
	const empty = projectVisitDetails(scope, period, []);
	expect(empty.lastActivityAt).toBeNull();
	expect(empty.daily.every((row) => row.validVisits === 0 && row.invalidVisits === 0)).toBe(true);
	expect(empty.browsers).toEqual([]);
});

test('daily guards keep exact family partitions, safe counts, and independent bounded language memberships', () => {
	const valid = contribution(2, 1, 10);
	expect(() =>
		checkDailyStatistics({
			...valid,
			browsers: [{ name: 'Other', validVisits: 1, invalidVisits: 1 }]
		})
	).toThrow(/^Invalid analytics report$/);
	expect(() =>
		checkDailyStatistics({ ...valid, validVisits: Number.MAX_SAFE_INTEGER + 1 })
	).toThrow(/^Invalid analytics report$/);
	expect(() =>
		checkDailyStatistics({
			...valid,
			acceptedLanguages: [{ name: 'en', validVisits: 3, invalidVisits: 0 }]
		})
	).toThrow(/^Invalid analytics report$/);
	expect(() =>
		checkDailyStatistics({
			...valid,
			browsers: [{ name: 'Other', validVisits: 2, invalidVisits: 1, ip: 'private' }]
		})
	).toThrow(/^Invalid analytics report$/);
});
