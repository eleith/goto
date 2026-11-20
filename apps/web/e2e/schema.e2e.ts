import { expect, test } from './support/test.ts';

test.use({ sharedAppHost: true });

test('serves the compiled app and short links on one host without shadowing other hosts', async ({
	request
}) => {
	const health = await request.get('/healthz');
	expect(health.status()).toBe(200);

	const admin = await request.get('/schema.json');
	expect(admin.status()).toBe(200);
	expect((await admin.json()).$schema).toBe('https://json-schema.org/draft/2020-12/schema');

	const asset = await request.get('/_app/version.json');
	expect(asset.status()).toBe(200);
	expect((await asset.json()).version).toEqual(expect.any(String));

	const staticPost = await request.post('/@static/favicon.svg', { maxRedirects: 0 });
	expect(staticPost.status()).toBe(405);
	expect(staticPost.headers().allow).toBe('GET, HEAD');

	const source = await request.get('/src/lib/auth-client.ts', { maxRedirects: 0 });
	expect(source.status()).toBe(404);

	const shortLink = await request.get('/docs', { maxRedirects: 0 });
	expect(shortLink.status()).toBe(302);
	expect(shortLink.headers().location).toBe('https://example.org/shared-docs');

	const root = await request.get('/', { maxRedirects: 0 });
	expect(root.status()).toBe(302);
	expect(root.headers().location).toBe('https://example.org/shared-fallback');

	const protectedPage = await request.get('/admin', {
		headers: { accept: 'text/html' },
		maxRedirects: 0
	});
	expect(protectedPage.status()).toBe(303);
	expect(protectedPage.headers().location).toBe('/signin?callbackUrl=%2Fadmin');
	expect(protectedPage.headers()['cache-control']).toBe('private, no-store');

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
