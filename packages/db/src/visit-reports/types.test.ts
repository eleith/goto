import { expect, test } from 'vitest';
import { visitReportKey, zeroVisitCounts } from './types.js';

test('zero counts are fresh objects', () => {
	const first = zeroVisitCounts();
	const second = zeroVisitCounts();
	first.total = 1;

	expect(second).toEqual({ total: 0, valid: 0, invalid: 0, base: 0 });
	expect(first).not.toBe(second);
});

test('scope keys use overview or JSON-encoded domains and exact paths', () => {
	expect(visitReportKey()).toBe('overview');
	expect(visitReportKey('go.example.test')).toBe('["go.example.test"]');
	expect(visitReportKey('go.example.test', '/')).toBe('["go.example.test","/"]');
	expect(visitReportKey('go.example.test', '/café,"docs')).toBe(
		JSON.stringify(['go.example.test', '/café,"docs'])
	);
});
