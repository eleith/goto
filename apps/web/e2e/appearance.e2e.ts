import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { expect, test } from './support/test.ts';

test.use({ javaScriptEnabled: false });

test('serves the favicon and Open Graph image on the app and shortening hosts', async ({
	page,
	request,
	appServer
}) => {
	await page.goto('/signin');
	await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Goto');
	await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
		'content',
		'Quick links. To get there. Quickly.'
	);
	await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
		'content',
		`${appServer.origin}/`
	);
	await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveJSProperty(
		'href',
		`${appServer.origin}/@static/favicon.svg`
	);

	const imageURL = `${appServer.origin}/@static/og.png`;
	await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', imageURL);
	const publicHost = { headers: { host: 'go.example.org' }, maxRedirects: 0 };
	const assets = [
		['favicon.svg', 'image/svg+xml'],
		['og.png', 'image/png'],
		['og.svg', 'image/svg+xml']
	];
	for (const [name, contentType] of assets) {
		const asset = await request.get(`/@static/${name}`, publicHost);
		expect(asset.status()).toBe(200);
		expect(asset.headers()['content-type']?.split(';', 1)[0]).toBe(contentType);
		expect(await asset.body()).toEqual(
			await readFile(new URL(`../static/@static/${name}`, import.meta.url))
		);
	}

	const adminImage = await request.get(imageURL, { maxRedirects: 0 });
	expect(adminImage.status()).toBe(200);
	expect(adminImage.headers()['content-type']?.split(';', 1)[0]).toBe('image/png');
	const imageBytes = await adminImage.body();
	expect(imageBytes).toEqual(await readFile(new URL('../static/@static/og.png', import.meta.url)));
	expect(imageBytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
		'content',
		String(imageBytes.readUInt32BE(16))
	);
	await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
		'content',
		String(imageBytes.readUInt32BE(20))
	);

	const head = await request.head('/@static/favicon.svg', publicHost);
	expect(head.status()).toBe(200);
	expect(head.headers()['content-type']?.split(';', 1)[0]).toBe('image/svg+xml');
	expect(await head.body()).toHaveLength(0);
});

test('renders responsive error pages on the app and shortening hosts', async ({
	page,
	request,
	appServer
}) => {
	await test.step('The shortening host renders a native 404', async () => {
		// This is a real compiled app asset, but it is not a link on the second public host.
		const publicOrigin = 'http://tiny.example.org';
		const publicPath = '/_app/version.json';
		const publicURL = `${publicOrigin}${publicPath}`;
		const options = {
			headers: { host: new URL(publicOrigin).host, accept: 'text/html' },
			maxRedirects: 0
		};
		const publicMissing = await request.get(publicPath, options);
		expect(publicMissing.status()).toBe(404);
		expect(publicMissing.headers()['content-type']?.split(';', 1)[0]).toBe('text/html');
		expect(publicMissing.headers()['location']).toBeUndefined();
		expect(publicMissing.headers()['cache-control']).toBe('no-store');
		expect(publicMissing.headers()['content-security-policy']).toContain("img-src 'self'");

		const head = await request.head(publicPath, options);
		expect(head.status()).toBe(404);
		expect(head.headers()['location']).toBeUndefined();
		expect(head.headers()['cache-control']).toBe('no-store');
		expect(await head.body()).toHaveLength(0);

		// Serve the built server's responses at the shortening origin without relying on DNS.
		const iconPath = '/@static/favicon.svg';
		const iconURL = `${publicOrigin}${iconPath}`;
		await page.route(`${publicOrigin}/**`, async (route) => {
			const url = route.request().url();
			if (url === publicURL) return route.fulfill({ response: publicMissing });
			if (url === iconURL) {
				const iconResponse = await request.get(iconPath, options);
				return route.fulfill({ response: iconResponse });
			}
			return route.abort();
		});
		await page.goto(publicURL);
		await expect(page).toHaveURL(publicURL);
		await expect(page).toHaveTitle('Not found — Goto');
		await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveJSProperty(
			'href',
			`${publicOrigin}/@static/favicon.svg`
		);
		await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
			'content',
			`${publicOrigin}/`
		);
		await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
			'content',
			`${publicOrigin}/@static/og.png`
		);
		await expect(page.locator('script, link[rel="modulepreload"]')).toHaveCount(0);
		const publicIcon = page.getByRole('img', { name: 'Goto', exact: true });
		await expect(publicIcon).toHaveJSProperty('src', iconURL);
		await expect
			.poll(() => publicIcon.evaluate((image: HTMLImageElement) => image.naturalWidth))
			.toBeGreaterThan(0);
		expect(await publicMissing.text()).not.toContain(appServer.origin);
		await expectErrorViewport(page);
	});

	await test.step('SvelteKit renders the app 404', async () => {
		const frameworkMissing = await page.goto('/missing-app-page');
		expect(frameworkMissing?.status()).toBe(404);
		await expect(page).toHaveTitle('Not found — Goto');
		await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveJSProperty(
			'href',
			`${appServer.origin}/@static/favicon.svg`
		);
		await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
			'content',
			`${appServer.origin}/`
		);
		await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
			'content',
			`${appServer.origin}/@static/og.png`
		);
		const appIcon = page.getByRole('img', { name: 'Goto', exact: true });
		await expect(appIcon).toHaveAttribute('src', '/@static/favicon.svg');
		await expect
			.poll(() => appIcon.evaluate((image: HTMLImageElement) => image.naturalWidth))
			.toBeGreaterThan(0);

		await expectErrorViewport(page);
	});
});

async function expectErrorViewport(page: Page) {
	const main = page.getByRole('main');
	const heading = main.getByRole('heading', { name: 'Not found', exact: true });
	const icon = main.getByRole('img', { name: 'Goto', exact: true });
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 }
	]) {
		await page.setViewportSize(viewport);
		await expect(heading).toBeVisible();
		await expect(heading).toBeInViewport();
		await expect(icon).toBeVisible();
		await expect(icon).toBeInViewport();
	}
}
