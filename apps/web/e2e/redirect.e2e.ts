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

	const conditionalOptions = {
		headers: {
			host: 'go.example.org',
			'accept-language': 'fr-CA,en;q=0.9',
			'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/158.0'
		},
		maxRedirects: 0
	};
	const conditional = await request.get('/DOCS/Install?from=browser', conditionalOptions);
	expect(conditional.status()).toBe(302);
	expect(conditional.headers().location).toBe(
		'https://example.org/french-linux/Install?from=browser'
	);
	expect(conditional.headers().vary).toBe('Accept-Language, User-Agent');
	const head = await request.head('/DOCS/Install?from=browser', conditionalOptions);
	expect(head.status()).toBe(302);
	expect(head.headers().location).toBe(conditional.headers().location);
	expect(await head.body()).toHaveLength(0);
});
