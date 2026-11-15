import { expect, test, vi } from 'vitest';
import { parseVisitDetails, parseVisitSummary } from './decode.js';
import { encodeVisitReports } from './encode.js';
import { createVisitPeriod, visitDays } from './period.js';
import {
	zeroVisitTotals,
	type PreparedVisitReport,
	type ReportScope,
	type VisitDetails,
	type VisitSummary,
	type VisitTotals
} from './reports.js';

const overview = { kind: 'overview' } as const;
const domain = { kind: 'domain', domain: 'go.example.test' } as const;
const root = { kind: 'link', domain: domain.domain, path: '/' } as const;
const asOf = Date.UTC(2026, 3, 1, 12);

function report(
	scope: ReportScope = overview,
	cutoff = asOf,
	totals: VisitTotals = { validVisits: 2, invalidVisits: 1 }
): PreparedVisitReport {
	const period = createVisitPeriod(3, cutoff);
	let summary: VisitSummary;
	if (scope.kind === 'overview') {
		summary = { version: 1, scope, period, totals, base: zeroVisitTotals(), domains: [] };
	} else if (scope.kind === 'domain') {
		summary = { version: 1, scope, period, totals, base: zeroVisitTotals(), links: [] };
	} else {
		summary = { version: 1, scope, period, totals };
	}
	const populated = totals.validVisits > 0 || totals.invalidVisits > 0;
	return {
		summary,
		details: {
			version: 4,
			scope,
			period,
			daily: visitDays(period).map((day, index) => ({
				...day,
				...(index === 0 ? totals : zeroVisitTotals())
			})),
			browsers: populated ? [{ day: period.from.slice(0, 10), name: 'Firefox', ...totals }] : [],
			operatingSystems: populated
				? [{ day: period.from.slice(0, 10), name: 'Linux', ...totals }]
				: [],
			acceptedLanguages: populated
				? [{ day: period.from.slice(0, 10), name: 'Other', ...totals }]
				: []
		}
	};
}

test('encodes each summary variant and explicit root without changing document shapes', () => {
	const reports = [
		report(overview),
		report(domain),
		report(root, asOf, { validVisits: 2, invalidVisits: 0 })
	];
	const rows = encodeVisitReports(reports);

	for (const [index, prepared] of reports.entries()) {
		const row = rows[index];
		if (!row) throw new Error('Expected a serialized fixture');
		expect(row.scope).toEqual(prepared.summary.scope);
		expect(parseVisitSummary(row.summaryJson, row.scope)).toEqual(prepared.summary);
		expect(parseVisitDetails(row.detailsJson, row.scope)).toEqual(prepared.details);
	}
	expect(encodeVisitReports([])).toEqual([]);
});

test('encodes each document once without a stringify-to-parse validation loop', () => {
	const reports = [report(overview), report(domain)];
	const stringify = vi.spyOn(JSON, 'stringify');
	const parse = vi.spyOn(JSON, 'parse');
	try {
		encodeVisitReports(reports);
		expect(stringify).toHaveBeenCalledTimes(4);
		expect(parse).not.toHaveBeenCalled();
	} finally {
		stringify.mockRestore();
		parse.mockRestore();
	}
});

test('rejects incompatible pair identities, periods, totals and document versions', () => {
	const prepared = report();
	for (const invalid of [
		{ ...prepared, summary: { ...prepared.summary, totals: { validVisits: 3, invalidVisits: 1 } } },
		{ ...prepared, details: { ...prepared.details, scope: root } },
		{
			...prepared,
			details: { ...prepared.details, period: createVisitPeriod(3, asOf + 86_400_000) }
		}
	]) {
		expect(() => encodeVisitReports([invalid])).toThrow('Invalid analytics report');
	}
	const wrongVersion = report();
	Object.assign(wrongVersion.details, { version: 1 });
	expect(() => encodeVisitReports([wrongVersion])).toThrow('Invalid analytics report');
});

test('batch checks duplicate scope identities and shared periods before serialization', () => {
	const stringify = vi.spyOn(JSON, 'stringify');
	try {
		for (const scope of [overview, domain, root]) {
			expect(() => encodeVisitReports([report(scope), report(scope)])).toThrow(
				'Invalid analytics report'
			);
		}
		expect(() => encodeVisitReports([report(overview), report(domain, asOf + 86_400_000)])).toThrow(
			'Invalid analytics report'
		);
		expect(stringify).not.toHaveBeenCalled();
	} finally {
		stringify.mockRestore();
	}
});

test('producer requires gap-free UTC days and correct partial flags including zero points', () => {
	const prepared = report();
	const daily = prepared.details.daily;
	const first = daily[0];
	if (!first) throw new Error('Expected a daily fixture');
	const invalidDaily: VisitDetails['daily'][] = [
		daily.slice(1),
		[...daily].reverse(),
		[{ ...first, start: prepared.details.period.from }, ...daily.slice(1)],
		[{ ...first, end: prepared.details.period.asOf }, ...daily.slice(1)],
		[{ ...first, partial: false }, ...daily.slice(1)]
	];
	for (const points of invalidDaily) {
		expect(() =>
			encodeVisitReports([
				{
					...prepared,
					details: { ...prepared.details, daily: points }
				}
			])
		).toThrow('Invalid analytics report');
	}
});

test('producer checks dated browser/OS sums and duplicate day/name pairs', () => {
	const prepared = report();
	const day = prepared.details.period.from.slice(0, 10);
	for (const details of [
		{ ...prepared.details, browsers: [] },
		{
			...prepared.details,
			operatingSystems: [{ day, name: 'Linux', validVisits: 3, invalidVisits: 0 }]
		},
		{
			...prepared.details,
			browsers: [
				{ day, name: 'Firefox', validVisits: 1, invalidVisits: 0 },
				{ day, name: 'Firefox', validVisits: 1, invalidVisits: 1 }
			]
		}
	]) {
		expect(() => encodeVisitReports([{ ...prepared, details }])).toThrow(
			'Invalid analytics report'
		);
	}
});

test('producer permits the same browser/OS name on different days but rejects moving counts between days', () => {
	const prepared = report();
	const first = prepared.details.daily[0];
	const second = prepared.details.daily[1];
	if (!first || !second) throw new Error('Expected daily fixtures');
	first.validVisits = 1;
	second.validVisits = 1;
	const browserOsCounts = [
		{ day: first.start.slice(0, 10), name: 'Other', validVisits: 1, invalidVisits: 1 },
		{ day: second.start.slice(0, 10), name: 'Other', validVisits: 1, invalidVisits: 0 }
	];
	prepared.details.browsers = browserOsCounts;
	prepared.details.operatingSystems = browserOsCounts;
	prepared.details.acceptedLanguages = browserOsCounts;
	expect(encodeVisitReports([prepared])).toHaveLength(1);
	const shifted = browserOsCounts.map((row, index) => ({
		...row,
		invalidVisits: index === 0 ? 0 : 1
	}));
	for (const details of [
		{ ...prepared.details, browsers: shifted },
		{ ...prepared.details, operatingSystems: shifted }
	]) {
		expect(() => encodeVisitReports([{ ...prepared, details }])).toThrow(
			'Invalid analytics report'
		);
	}
});

test('producer permits overlapping language counts while bounding each bucket to its day', () => {
	const prepared = report();
	const day = prepared.details.period.from.slice(0, 10);
	const rows = [
		{ day, name: 'fr', validVisits: 2, invalidVisits: 1 },
		{ day, name: 'en', validVisits: 2, invalidVisits: 1 }
	];
	prepared.details.acceptedLanguages = rows;
	const [encoded] = encodeVisitReports([prepared]);
	if (!encoded) throw new Error('Expected a serialized fixture');
	expect(parseVisitDetails(encoded.detailsJson, overview).acceptedLanguages).toEqual(rows);
	expect(parseVisitSummary(encoded.summaryJson, overview).totals).toEqual({
		validVisits: 2,
		invalidVisits: 1
	});

	for (const acceptedLanguages of [
		[...rows, ...rows],
		[{ day, name: 'fr', validVisits: 3, invalidVisits: 1 }],
		[{ day, name: 'fr', validVisits: 2, invalidVisits: 2 }],
		[{ day: '2026-01-02', name: 'fr', validVisits: 1, invalidVisits: 0 }]
	]) {
		expect(() =>
			encodeVisitReports([{ ...prepared, details: { ...prepared.details, acceptedLanguages } }])
		).toThrow('Invalid analytics report');
	}

	expect(encodeVisitReports([report(overview, asOf, zeroVisitTotals())])).toHaveLength(1);
});

test('producer rejects base or compact child subsets above totals and duplicate children', () => {
	const prepared = report();
	for (const summary of [
		{ ...prepared.summary, base: { validVisits: 3, invalidVisits: 0 } },
		{
			...prepared.summary,
			domains: [
				{ domain: domain.domain, totals: zeroVisitTotals() },
				{ domain: domain.domain, totals: zeroVisitTotals() }
			]
		},
		{
			...prepared.summary,
			domains: [{ domain: domain.domain, totals: { validVisits: 5, invalidVisits: 0 } }]
		}
	]) {
		expect(() => encodeVisitReports([{ ...prepared, summary }])).toThrow(
			'Invalid analytics report'
		);
	}
	const domainReport = report(domain);
	const duplicateLinks = {
		...domainReport.summary,
		links: [
			{ path: '/', totals: zeroVisitTotals() },
			{ path: '/', totals: zeroVisitTotals() }
		]
	};
	expect(() => encodeVisitReports([{ ...domainReport, summary: duplicateLinks }])).toThrow(
		'Invalid analytics report'
	);
});

test('producer rejects unsafe summed counts even when each input count is safe', () => {
	const prepared = report(overview, asOf, {
		validVisits: Number.MAX_SAFE_INTEGER,
		invalidVisits: 0
	});
	const secondDay = prepared.details.daily[1];
	if (!secondDay) throw new Error('Expected a second daily fixture');
	secondDay.validVisits = 1;
	expect(() => encodeVisitReports([prepared])).toThrow('Invalid analytics report');
});
