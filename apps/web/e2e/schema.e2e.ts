import { expect, test } from './support/test.ts';

test('the compiled schema is public only on the configured admin origin', async ({ request }) => {
	const admin = await request.get('/schema.json');

	expect(admin.status()).toBe(200);
	expect((await admin.json()).$schema).toBe('https://json-schema.org/draft/2020-12/schema');

	for (const path of ['/schema.json', '/%73chema.json']) {
		const publicHost = await request.get(path, { headers: { host: 'go.example.org' } });
		expect(publicHost.status()).toBe(404);
	}
});
