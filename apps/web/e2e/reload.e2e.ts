import { readFile, rename, writeFile } from 'node:fs/promises';
import { expect, test } from './support/test.ts';

type Fixture = {
	analytics: { retention_months: number };
	domains: Record<string, { links: Record<string, { url: string }> }>;
};

test('atomic YAML saves update redirects while rejected saves retain the last working config', async ({
	request,
	appServer
}) => {
	const path = appServer.configurationPath;
	const configuration = JSON.parse(await readFile(path, 'utf8')) as Fixture;
	const link = configuration.domains['go.example.org']!.links['/docs']!;
	const polling = { timeout: 10_000, intervals: [1000] };

	async function save(source: string) {
		await writeFile(`${path}.next`, source);
		await rename(`${path}.next`, path);
	}

	async function destination() {
		const response = await request.get('/docs', {
			headers: { host: 'go.example.org' },
			maxRedirects: 0
		});
		expect(response.status()).toBe(302);
		return response.headers().location;
	}

	expect(await destination()).toBe(link.url);
	link.url = 'https://example.org/reloaded';
	configuration.analytics.retention_months = 9;
	await save(JSON.stringify(configuration));
	await expect.poll(destination, polling).toBe(link.url);

	const rejected = structuredClone(configuration);
	rejected.analytics.retention_months = 3;
	rejected.domains['go.example.org']!.links['/docs']!.url = 'https://example.org/blocked';
	await save(JSON.stringify(rejected));
	await expect
		.poll(appServer.logs, polling)
		.toContain('Retention reduction requires a coordinated restart');
	expect(await destination()).toBe(link.url);

	await save('site: [\n');
	await expect
		.poll(appServer.logs, polling)
		.toContain(
			'Invalid configuration update; previous configuration remains active until a valid update is loaded'
		);
	expect(await destination()).toBe(link.url);

	link.url = 'https://example.org/recovered';
	await save(JSON.stringify(configuration));
	await expect.poll(destination, polling).toBe(link.url);
});
