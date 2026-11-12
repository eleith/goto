import { expect, test } from 'vitest';
import { parseVisitDetails, parseVisitSummary } from './decode.js';
import { createVisitPeriod, visitDays } from './period.js';
import { zeroVisitTotals, type OverviewSummary, type VisitDetails } from './reports.js';

const scope = { kind: 'overview' } as const;
const period = createVisitPeriod(3, Date.UTC(2026, 3, 1, 12));
const summary: OverviewSummary = {
	version: 1,
	scope,
	period,
	totals: { validVisits: 2, invalidVisits: 1 },
	base: { validVisits: 1, invalidVisits: 0 },
	domains: []
};
const details: VisitDetails = {
	version: 2,
	scope,
	period,
	daily: visitDays(period).map((day, index) => ({
		...day,
		...(index === 0 ? summary.totals : zeroVisitTotals())
	})),
	browsers: [{ day: period.from.slice(0, 10), name: 'Firefox', ...summary.totals }],
	operatingSystems: [{ day: period.from.slice(0, 10), name: 'Linux', ...summary.totals }]
};

test('readers decode their self-contained document independently', () => {
	expect(parseVisitSummary(JSON.stringify(summary), scope)).toEqual(summary);
	expect(parseVisitDetails(JSON.stringify(details), scope)).toEqual(details);
});

test('details reader can require the same reporting policy and window', () => {
	expect(parseVisitDetails(JSON.stringify(details), scope, period)).toEqual(details);
	const nextPeriod = createVisitPeriod(3, Date.UTC(2026, 3, 2, 12));
	const nextDetails = {
		...details,
		period: nextPeriod,
		daily: visitDays(nextPeriod).map((day) => ({ ...day, ...zeroVisitTotals() })),
		browsers: [],
		operatingSystems: []
	};
	expect(parseVisitDetails(JSON.stringify(nextDetails), scope)).toEqual(nextDetails);
	expect(() => parseVisitDetails(JSON.stringify(nextDetails), scope, period)).toThrow(
		'Invalid analytics report'
	);
	const otherPolicy = createVisitPeriod(9, Date.parse(period.asOf));
	expect(() => parseVisitDetails(JSON.stringify(details), scope, otherPolicy)).toThrow(
		'Invalid analytics report'
	);
});

test('summary reader rejects unsupported versions, unsafe counts and wrong identities safely', () => {
	for (const invalid of [
		{ ...summary, version: 2 },
		{ ...summary, totals: { validVisits: -1, invalidVisits: 0 } },
		{ ...summary, totals: { validVisits: 0.5, invalidVisits: 0 } },
		{ ...summary, totals: { validVisits: Number.MAX_SAFE_INTEGER + 1, invalidVisits: 0 } },
		{ ...summary, unexpected: 'private' }
	]) {
		expect(() => parseVisitSummary(JSON.stringify(invalid), scope)).toThrow(
			'Invalid analytics report'
		);
	}
	expect(() =>
		parseVisitSummary(JSON.stringify(summary), { kind: 'domain', domain: 'private' })
	).toThrow('Invalid analytics report');
	expect(() => parseVisitSummary('{private', scope)).toThrow('Invalid analytics report');
});

test('readers reject noncanonical, reversed and non-retention windows', () => {
	for (const invalidPeriod of [
		{ ...period, asOf: 'not-a-date' },
		{ ...period, asOf: period.asOf.replace('.000Z', 'Z') },
		{ ...period, from: '2026-02-30T12:00:00.000Z' },
		{ ...period, from: period.asOf },
		{ ...period, from: '2025-01-01T00:00:00.000Z' }
	]) {
		expect(() =>
			parseVisitSummary(JSON.stringify({ ...summary, period: invalidPeriod }), scope)
		).toThrow('Invalid analytics report');
		expect(() =>
			parseVisitDetails(JSON.stringify({ ...details, period: invalidPeriod }), scope)
		).toThrow('Invalid analytics report');
	}
});

test('details reader checks daily instants, window safety, counts and scope', () => {
	const first = details.daily[0];
	if (!first) throw new Error('Expected a daily fixture');
	for (const point of [
		{ ...first, start: 'not-a-date' },
		{ ...first, end: first.end.replace('.000Z', 'Z') },
		{ ...first, start: '2026-02-30T00:00:00.000Z' },
		{ ...first, start: first.end },
		{ ...first, start: period.asOf, end: '2026-04-02T00:00:00.000Z' },
		{ ...first, invalidVisits: -1 }
	]) {
		expect(() => parseVisitDetails(JSON.stringify({ ...details, daily: [point] }), scope)).toThrow(
			'Invalid analytics report'
		);
	}
	expect(() => parseVisitDetails(JSON.stringify({ ...details, version: 1 }), scope)).toThrow(
		'Invalid analytics report'
	);
	expect(() =>
		parseVisitDetails(JSON.stringify(details), { kind: 'domain', domain: 'private' })
	).toThrow('Invalid analytics report');
	expect(() => parseVisitDetails('{private', scope)).toThrow('Invalid analytics report');
});

test('details reader requires canonical UTC browser/OS days intersecting the retained reporting period', () => {
	for (const day of [
		'2026-1-01',
		'2026-02-30',
		'2026-01-01T00:00:00.000Z',
		'2025-12-31',
		'2026-04-02'
	]) {
		const rows = [{ day, name: 'Other', validVisits: 1, invalidVisits: 0 }];
		for (const invalid of [
			{ ...details, browsers: rows },
			{ ...details, operatingSystems: rows }
		]) {
			expect(() => parseVisitDetails(JSON.stringify(invalid), scope)).toThrow(
				'Invalid analytics report'
			);
		}
	}
	const midnightPeriod = createVisitPeriod(3, Date.UTC(2026, 3, 1));
	expect(() =>
		parseVisitDetails(
			JSON.stringify({
				...details,
				period: midnightPeriod,
				daily: [],
				browsers: [{ day: '2026-04-01', name: 'Other', validVisits: 1, invalidVisits: 0 }]
			}),
			scope
		)
	).toThrow('Invalid analytics report');
});

test('details reader accepts safe partial-edge browser/OS rows without redoing producer arithmetic', () => {
	const document = {
		...details,
		browsers: [
			{ day: '2026-01-01', name: 'Other', validVisits: 7, invalidVisits: 0 },
			{ day: '2026-04-01', name: 'Other', validVisits: 8, invalidVisits: 0 }
		]
	};
	expect(parseVisitDetails(JSON.stringify(document), scope)).toEqual(document);
});

test('reader prevents a base subset from exceeding totals used by page subtraction', () => {
	expect(() =>
		parseVisitSummary(
			JSON.stringify({
				...summary,
				base: { validVisits: 3, invalidVisits: 0 }
			}),
			scope
		)
	).toThrow('Invalid analytics report');
});
