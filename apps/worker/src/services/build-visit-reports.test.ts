import { createVisitPeriod, visitDays } from '@goto/analytics';
import { expect, test } from 'vitest';
import { buildVisitReports } from './build-visit-reports.js';

test('builds gap-free UTC daily details with zeros and partial calendar edges', () => {
	const period = createVisitPeriod(3, Date.parse('2026-05-31T12:34:56.789Z'));
	const [report] = buildVisitReports(
		{
			daily: [
				{
					scopeKind: 'overview',
					domain: null,
					path: null,
					day: '2026-02-28',
					validVisits: 2,
					invalidVisits: 1,
					baseValidVisits: 1,
					baseInvalidVisits: 0
				},
				{
					scopeKind: 'overview',
					domain: null,
					path: null,
					day: '2026-05-31',
					validVisits: 1,
					invalidVisits: 4,
					baseValidVisits: 0,
					baseInvalidVisits: 2
				}
			],
			browsers: [
				{
					scopeKind: 'overview',
					domain: null,
					path: null,
					family: 'Firefox',
					validVisits: 3,
					invalidVisits: 5
				}
			],
			operatingSystems: [
				{
					scopeKind: 'overview',
					domain: null,
					path: null,
					family: 'Linux',
					validVisits: 3,
					invalidVisits: 5
				}
			]
		},
		[],
		period
	);

	expect(report?.summary).toEqual({
		version: 1,
		scope: { kind: 'overview' },
		period,
		totals: { validVisits: 3, invalidVisits: 5 },
		base: { validVisits: 1, invalidVisits: 2 },
		domains: []
	});
	expect(report?.details.daily).toHaveLength(visitDays(period).length);
	expect(report?.details.daily[0]).toEqual({
		start: '2026-02-28T00:00:00.000Z',
		end: '2026-03-01T00:00:00.000Z',
		partial: true,
		validVisits: 2,
		invalidVisits: 1
	});
	expect(report?.details.daily[1]).toEqual({
		start: '2026-03-01T00:00:00.000Z',
		end: '2026-03-02T00:00:00.000Z',
		partial: false,
		validVisits: 0,
		invalidVisits: 0
	});
	expect(report?.details.daily.at(-1)).toEqual({
		start: '2026-05-31T00:00:00.000Z',
		end: '2026-06-01T00:00:00.000Z',
		partial: true,
		validVisits: 1,
		invalidVisits: 4
	});
});

test('indexes explicit domain and link scopes, including empty links and root, without mixing families', () => {
	const period = createVisitPeriod(3, Date.parse('2026-07-01T12:00:00Z'));
	const overview = { scopeKind: 'overview' as const, domain: null, path: null };
	const domain = { scopeKind: 'domain' as const, domain: 'go.example.test', path: null };
	const link = { scopeKind: 'link' as const, domain: 'go.example.test', path: '/docs' };
	const root = { ...link, path: '/' };
	const reports = buildVisitReports(
		{
			daily: [
				{
					...overview,
					day: '2026-06-01',
					validVisits: 8,
					invalidVisits: 3,
					baseValidVisits: 1,
					baseInvalidVisits: 1
				},
				{
					...domain,
					day: '2026-06-01',
					validVisits: 4,
					invalidVisits: 2,
					baseValidVisits: 1,
					baseInvalidVisits: 1
				},
				{
					...link,
					day: '2026-06-01',
					validVisits: 2,
					invalidVisits: 0,
					baseValidVisits: 0,
					baseInvalidVisits: 0
				},
				{
					...root,
					day: '2026-06-01',
					validVisits: 1,
					invalidVisits: 1,
					baseValidVisits: 1,
					baseInvalidVisits: 1
				}
			],
			browsers: [
				{ ...overview, family: 'Other', validVisits: 8, invalidVisits: 3 },
				{ ...domain, family: 'Firefox', validVisits: 4, invalidVisits: 2 },
				{ ...link, family: 'Chrome', validVisits: 2, invalidVisits: 0 },
				{ ...root, family: 'Firefox', validVisits: 1, invalidVisits: 1 }
			],
			operatingSystems: [
				{ ...overview, family: 'Other', validVisits: 8, invalidVisits: 3 },
				{ ...domain, family: 'Linux', validVisits: 4, invalidVisits: 2 },
				{ ...link, family: 'Linux', validVisits: 2, invalidVisits: 0 },
				{ ...root, family: 'Linux', validVisits: 1, invalidVisits: 1 }
			]
		},
		[
			{ domain: 'go.example.test', paths: ['/docs', '/empty', '/'] },
			{ domain: 'empty.example.test', paths: ['/docs'] }
		],
		period
	);
	const docs = reports.find(
		({ summary }) => summary.scope.kind === 'link' && summary.scope.path === '/docs'
	);
	const base = reports.find(
		({ summary }) => summary.scope.kind === 'link' && summary.scope.path === '/'
	);
	const empty = reports.find(
		({ summary }) => summary.scope.kind === 'link' && summary.scope.path === '/empty'
	);
	const domainReport = reports.find(({ summary }) => summary.scope.kind === 'domain');
	const overviewReport = reports.find(({ summary }) => summary.scope.kind === 'overview');

	expect(reports).toHaveLength(8);
	expect(domainReport?.summary).toEqual({
		version: 1,
		scope: { kind: 'domain', domain: 'go.example.test' },
		period,
		totals: { validVisits: 4, invalidVisits: 2 },
		base: { validVisits: 1, invalidVisits: 1 },
		links: [
			{ path: '/docs', totals: { validVisits: 2, invalidVisits: 0 } },
			{ path: '/empty', totals: { validVisits: 0, invalidVisits: 0 } },
			{ path: '/', totals: { validVisits: 1, invalidVisits: 1 } }
		]
	});
	expect(overviewReport?.summary).toEqual({
		version: 1,
		scope: { kind: 'overview' },
		period,
		totals: { validVisits: 8, invalidVisits: 3 },
		base: { validVisits: 1, invalidVisits: 1 },
		domains: [
			{ domain: 'go.example.test', totals: { validVisits: 4, invalidVisits: 2 } },
			{ domain: 'empty.example.test', totals: { validVisits: 0, invalidVisits: 0 } }
		]
	});
	expect(docs?.summary).toEqual({
		version: 1,
		scope: { kind: 'link', domain: 'go.example.test', path: '/docs' },
		period,
		totals: { validVisits: 2, invalidVisits: 0 }
	});
	expect(docs?.details.browsers).toEqual([{ family: 'Chrome', validVisits: 2, invalidVisits: 0 }]);
	expect(domainReport?.details.browsers).toEqual([
		{ family: 'Firefox', validVisits: 4, invalidVisits: 2 }
	]);
	expect(base?.details.operatingSystems).toEqual([
		{ family: 'Linux', validVisits: 1, invalidVisits: 1 }
	]);
	expect(empty?.summary.totals).toEqual({ validVisits: 0, invalidVisits: 0 });
	expect(empty?.details.daily).toEqual(
		visitDays(period).map((day) => ({ ...day, validVisits: 0, invalidVisits: 0 }))
	);
	expect(empty?.details.browsers).toEqual([]);
	const otherDomainDocs = reports.find(
		({ summary }) =>
			summary.scope.kind === 'link' &&
			summary.scope.domain === 'empty.example.test' &&
			summary.scope.path === '/docs'
	);
	expect(otherDomainDocs?.summary.totals).toEqual({ validVisits: 0, invalidVisits: 0 });
	const otherDomain = reports.find(
		({ summary }) =>
			summary.scope.kind === 'domain' && summary.scope.domain === 'empty.example.test'
	);
	expect(otherDomain?.summary).toEqual({
		version: 1,
		scope: { kind: 'domain', domain: 'empty.example.test' },
		period,
		totals: { validVisits: 0, invalidVisits: 0 },
		base: { validVisits: 0, invalidVisits: 0 },
		links: [{ path: '/docs', totals: { validVisits: 0, invalidVisits: 0 } }]
	});
	const unconfiguredRoot = reports.find(
		({ summary }) =>
			summary.scope.kind === 'link' &&
			summary.scope.domain === 'empty.example.test' &&
			summary.scope.path === '/'
	);
	expect(unconfiguredRoot?.summary.totals).toEqual({ validVisits: 0, invalidVisits: 0 });
	for (const report of reports) {
		expect(report.details.scope).toEqual(report.summary.scope);
		expect(report.details.period).toEqual(period);
	}
});
