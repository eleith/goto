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
	version: 1,
	scope,
	period,
	daily: visitDays(period).map((day, index) => ({
		...day,
		...(index === 0 ? summary.totals : zeroVisitTotals())
	})),
	browsers: [{ family: 'Firefox', ...summary.totals }],
	operatingSystems: [{ family: 'Linux', ...summary.totals }]
};

test('readers decode their self-contained document independently', () => {
	expect(parseVisitSummary(JSON.stringify(summary), scope)).toEqual(summary);
	expect(parseVisitDetails(JSON.stringify(details), scope)).toEqual(details);
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
	expect(() => parseVisitDetails(JSON.stringify({ ...details, version: 2 }), scope)).toThrow(
		'Invalid analytics report'
	);
	expect(() =>
		parseVisitDetails(JSON.stringify(details), { kind: 'domain', domain: 'private' })
	).toThrow('Invalid analytics report');
	expect(() => parseVisitDetails('{private', scope)).toThrow('Invalid analytics report');
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
