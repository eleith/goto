import { expect, test } from './support/test.ts';

test('serves compiled app endpoints without shadowing public redirects', async ({ request }) => {
	const health = await request.get('/healthz');
	expect(health.status()).toBe(200);

	const admin = await request.get('/schema.json');
	expect(admin.status()).toBe(200);
	expect((await admin.json()).$schema).toBe('https://json-schema.org/draft/2020-12/schema');

	const asset = await request.get('/_app/version.json');
	expect(asset.status()).toBe(200);
	expect((await asset.json()).version).toEqual(expect.any(String));

	for (const [path, destination] of [
		['/schema.json', 'public-schema'],
		['/%73chema.json', 'public-schema'],
		['/_app/version.json', 'public-asset']
	]) {
		const response = await request.get(path!, {
			headers: { host: 'go.example.org', 'x-forwarded-host': 'admin.example.test' },
			maxRedirects: 0
		});
		expect(response.status()).toBe(302);
		expect(response.headers().location).toBe(`https://example.org/${destination}`);
	}

	const unknown = await request.get('/_app/version.json', {
		headers: { host: 'unknown.example.org' }
	});
	expect(unknown.status()).toBe(404);
});
