import { expect, test } from './support/test.ts';

test('the Node boundary preserves domains and raw paths before framework routing', async ({
	request
}) => {
	for (const [host, path, destination] of [
		['go.example.org', '/docs', 'first-domain'],
		['tiny.example.org', '/docs', 'second-domain'],
		['go.example.org', '/a%2Fb', 'decoded'],
		['go.example.org', '/a%252Fb', 'literal-percent'],
		['go.example.org', '/healthz', 'public-health']
	]) {
		const response = await request.get(path!, { headers: { host: host! }, maxRedirects: 0 });
		expect(response.status()).toBe(302);
		expect(response.headers().location).toBe(`https://example.org/${destination}`);
	}

	const head = await request.head('/docs', {
		headers: { host: 'go.example.org' },
		maxRedirects: 0
	});
	expect(head.status()).toBe(302);
	expect(await head.body()).toHaveLength(0);
});
