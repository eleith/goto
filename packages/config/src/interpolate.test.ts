import { describe, expect, it } from 'vitest';
import { ConfigError } from './errors.js';
import { interpolate } from './interpolate.js';

describe('interpolate', () => {
	it('expands values recursively without expanding keys or mutating input', () => {
		const input = { '${NAME}': ['${NAME}', { value: '${ABSENT:-default}' }] };
		expect(interpolate(input, { NAME: 'resolved' })).toEqual({
			'${NAME}': ['resolved', { value: 'default' }]
		});
		expect(input['${NAME}'][0]).toBe('${NAME}');
	});

	it('uses fallbacks only for unset variables, not empty values', () => {
		expect(interpolate(['${EMPTY:-fallback}', '${MISSING:-fallback}'], { EMPTY: '' })).toEqual([
			'',
			'fallback'
		]);
	});

	it('escapes dollars and never expands replacements a second time', () => {
		expect(
			interpolate(['$${NAME}', '${NAME}', '${lower}'], {
				NAME: '${OTHER}',
				OTHER: 'not-expanded'
			})
		).toEqual(['${NAME}', '${OTHER}', '${lower}']);
	});

	it('returns a generic error without the surrounding secret-bearing value', () => {
		expect(() => interpolate({ auth: { secret: 'private-${MISSING}' } }, {})).toThrowError(
			new ConfigError()
		);
	});
});
