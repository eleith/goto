import { Value } from '@sinclair/typebox/value';
import { expect, test } from 'vitest';
import { createVisitPeriod } from './period.js';
import {
	ReportScopeSchema,
	VisitSummarySchema,
	zeroVisitTotals,
	type LinkSummary
} from './reports.js';

test('zero totals are independent objects with no redundant total or root count', () => {
	const first = zeroVisitTotals();
	const second = zeroVisitTotals();
	first.validVisits = 1;

	expect(second).toEqual({ validVisits: 0, invalidVisits: 0 });
	expect(first).not.toBe(second);
});

test('canonical schemas distinguish scopes and summary variants', () => {
	const summary: LinkSummary = {
		version: 1,
		scope: { kind: 'link', domain: 'go.example.test', path: '/' },
		period: createVisitPeriod(3, Date.UTC(2026, 2, 1)),
		totals: zeroVisitTotals()
	};

	expect(Value.Check(VisitSummarySchema, summary)).toBe(true);
	expect(Value.Check(VisitSummarySchema, { ...summary, base: zeroVisitTotals() })).toBe(false);
	expect(Value.Check(ReportScopeSchema, { kind: 'overview', domain: null })).toBe(false);
	expect(
		Value.Check(ReportScopeSchema, { kind: 'domain', domain: 'go.example.test', path: '/' })
	).toBe(false);
	expect(
		Value.Check(ReportScopeSchema, { kind: 'link', domain: 'go.example.test', path: '' })
	).toBe(false);
});
