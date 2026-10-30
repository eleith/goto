import { expect, test } from 'vitest';
import { GET } from './+server.js';

test('reports liveness without caching the response', async () => {
	const response = GET();

	expect(response.status).toBe(200);
	expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(await response.text()).toBe('ok\n');
});
