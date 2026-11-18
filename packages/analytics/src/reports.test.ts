import { Value } from '@sinclair/typebox/value';
import { expect, test } from 'vitest';
import { ReportScopeSchema, VisitTotalsSchema, zeroVisitTotals } from './reports.js';

test('zero totals are independent objects with no redundant total or root count', () => {
	const first = zeroVisitTotals();
	const second = zeroVisitTotals();
	first.validVisits = 1;

	expect(second).toEqual({ validVisits: 0, invalidVisits: 0 });
	expect(first).not.toBe(second);
});

test('canonical schemas distinguish scopes and require safe exact totals', () => {
	expect(Value.Check(ReportScopeSchema, { kind: 'overview' })).toBe(true);
	expect(
		Value.Check(ReportScopeSchema, { kind: 'link', domain: 'go.example.test', path: '/' })
	).toBe(true);
	expect(Value.Check(ReportScopeSchema, { kind: 'overview', domain: null })).toBe(false);
	expect(
		Value.Check(ReportScopeSchema, { kind: 'domain', domain: 'go.example.test', path: '/' })
	).toBe(false);
	expect(
		Value.Check(ReportScopeSchema, { kind: 'link', domain: 'go.example.test', path: '' })
	).toBe(false);
	expect(Value.Check(VisitTotalsSchema, zeroVisitTotals())).toBe(true);
	for (const invalid of [
		{ validVisits: -1, invalidVisits: 0 },
		{ validVisits: 0.5, invalidVisits: 0 },
		{ validVisits: Number.MAX_SAFE_INTEGER + 1, invalidVisits: 0 },
		{ ...zeroVisitTotals(), base: 0 }
	])
		expect(Value.Check(VisitTotalsSchema, invalid)).toBe(false);
});
