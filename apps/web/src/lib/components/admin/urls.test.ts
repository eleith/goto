import { expect, test } from 'vitest';
import { tagHref } from './urls.js';

test('encodes the whole literal tag as one segment and optionally carries the timeframe', () => {
	expect(tagHref(' Work/100%é ')).toBe('/admin/tags/%20Work%2F100%25%C3%A9%20');
	expect(tagHref('%2F', '7d')).toBe('/admin/tags/%252F?period=7d');
});
