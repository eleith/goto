import schema from '@goto/config/schema.json' with { type: 'json' };
import { expect, test } from 'vitest';
import { GET } from './+server.js';

test('serves the generated authoring schema without deployment configuration', async () => {
	const response = GET();

	expect(response.headers.get('content-type')).toBe('application/schema+json; charset=utf-8');
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(await response.json()).toEqual(schema);
});
