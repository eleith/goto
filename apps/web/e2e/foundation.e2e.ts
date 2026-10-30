import { expect, test } from './support/test.ts';

test('the compiled application starts and serves requests', async ({ request }) => {
	const response = await request.get('/healthz');

	expect(response.ok()).toBe(true);
});
