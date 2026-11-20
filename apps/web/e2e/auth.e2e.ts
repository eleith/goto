import type { Request } from '@playwright/test';
import { expect, test } from './support/test.ts';

test.use({ withWorker: true });

const sharedTag = 'Work/100%é';
const tagPath = '/admin/tags/Work%2F100%25%C3%A9';

test('shared credentials protect admin pages and sign-out removes access', async ({
	page,
	request,
	appServer
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	const navigationWarnings: string[] = [];
	page.on('console', (message) => {
		const text = message.text();
		if (text.includes('push_state_deprecated')) navigationWarnings.push(text);
	});
	const adminRedirect = await request.get('/admin', {
		headers: { accept: 'text/html' },
		maxRedirects: 0
	});
	expect(adminRedirect.status()).toBe(303);
	expect(adminRedirect.headers()['cache-control']).toBe('private, no-store');

	const signInPage = await page.goto(`${appServer.origin}/admin`);
	await expect(page).toHaveURL(/\/signin\?/);
	expect(signInPage?.headers()['cache-control']).toBe('private, no-store');
	await page.getByLabel('Username', { exact: true }).fill('example');
	await page.getByLabel('Password', { exact: true }).fill('incorrect');
	const failedSignIn = page.waitForResponse(`${appServer.origin}/auth/sign-in/credentials`);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	expect((await failedSignIn).headers()['cache-control']).toBe('private, no-store');
	await expect(page.getByRole('alert')).toContainText('Invalid username or password');

	await page.getByLabel('Password', { exact: true }).fill('e2e-only-password');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
	const visitsValue = page
		.getByRole('region', { name: 'Visits', exact: true })
		.locator('.admin-stat-value');
	await expect(page.getByRole('region', { name: 'Domains', exact: true })).toContainText('2');
	await expect(visitsValue).toHaveText('3');
	const acceptedLanguages = page.getByRole('region', { name: 'Accepted languages', exact: true });
	await expect(acceptedLanguages.getByRole('columnheader')).toHaveText([
		'Language',
		'Visits',
		'Share'
	]);
	await expect(
		acceptedLanguages.getByRole('rowheader', { name: 'Other', exact: true })
	).toBeVisible();
	const browsers = page.getByRole('region', { name: 'Browsers', exact: true });
	const operatingSystems = page.getByRole('region', { name: 'Operating systems', exact: true });
	await expect(browsers).toBeVisible();
	await expect(operatingSystems).toBeVisible();
	await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText([
		'Domains',
		'Links',
		'Visits',
		'Retention'
	]);
	const heading = page.locator('.admin-heading');
	await expect(heading.locator('.admin-title > h1 + time')).toBeVisible();
	const timeframe = heading.getByRole('group', { name: 'Timeframe', exact: true });
	await expect(timeframe.getByRole('button')).toHaveText(['7 days', '30 days', '3 months']);
	await expect(timeframe.getByRole('button', { name: '30 days', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const trend = page.getByRole('region', { name: 'Visits over time', exact: true });
	const graph = trend.getByRole('img');
	await expect(graph).toHaveAttribute('aria-busy', 'false');
	const chartTable = trend.getByRole('table');
	await expect(chartTable).toBeVisible();
	await expect(chartTable).toHaveAccessibleName('Visits');
	await expect(chartTable.getByRole('columnheader')).toHaveText(['Period (UTC)', 'Visits']);
	await expect(chartTable.getByRole('row', { name: 'Total 3', exact: true })).toBeVisible();
	await expect(chartTable).not.toContainText('(partial)');
	await expect(trend.getByRole('region', { name: 'Visit data', exact: true })).toHaveAttribute(
		'tabindex',
		'0'
	);
	await expect(graph).toBeVisible();
	await expect(graph).toHaveAccessibleName(/^Visits by day\. Total: 3\./);
	const domainLink = page.getByRole('link', { name: 'go.example.org', exact: true });
	const domainRow = page.getByRole('listitem').filter({ has: domainLink });
	const domainCounts = domainRow.locator('.admin-inventory-number');
	await expect(domainCounts).toHaveText(['6', '2']);
	const selectionRequests: string[] = [];
	const recordSelectionRequest = (request: Request) => {
		const type = request.resourceType();
		if (type === 'document' || type === 'fetch' || type === 'xhr') {
			selectionRequests.push(request.url());
		}
	};
	page.on('request', recordSelectionRequest);
	await timeframe.getByRole('button', { name: '7 days', exact: true }).click();
	await expect(page).toHaveURL(`${appServer.origin}/admin?period=7d`);
	await expect(timeframe.getByRole('button', { name: '7 days', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('2');
	await expect(domainCounts).toHaveText(['6', '1']);
	await expect(graph).toHaveAccessibleName(/^Visits by day\. Total: 2\./);
	await timeframe.getByRole('button', { name: '3 months', exact: true }).click();
	await expect(timeframe.getByRole('button', { name: '3 months', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('4');
	await expect(domainCounts).toHaveText(['6', '3']);
	await expect(graph).toHaveAccessibleName(/^Visits by week\. Total: 4\./);
	await page.goBack();
	await expect(timeframe.getByRole('button', { name: '7 days', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('2');
	await expect(domainCounts).toHaveText(['6', '1']);
	await expect(graph).toHaveAccessibleName(/^Visits by day\. Total: 2\./);
	await page.goForward();
	await expect(timeframe.getByRole('button', { name: '3 months', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('4');
	await expect(domainCounts).toHaveText(['6', '3']);
	await expect(graph).toHaveAccessibleName(/^Visits by week\. Total: 4\./);
	page.off('request', recordSelectionRequest);
	expect(selectionRequests).toEqual([]);
	const overviewResponse = await page.reload();
	expect(overviewResponse?.headers()['cache-control']).toBe('private, no-store');
	await expect(timeframe.getByRole('button', { name: '3 months', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('4');
	await expect(graph).toHaveAccessibleName(/^Visits by week\. Total: 4\./);
	expect(navigationWarnings).toEqual([]);
	await domainLink.click();
	await expect(page.getByRole('heading', { name: 'Domain', exact: true })).toBeVisible();
	const context = page.locator('.admin-context');
	await expect(context).toHaveCount(0);
	await expect(page).toHaveTitle('Domain — go.example.org — Goto');
	await expect(acceptedLanguages).toBeVisible();
	await expect(browsers.getByRole('columnheader')).toHaveText(['Browser', 'Visits', 'Share']);
	await expect(operatingSystems.getByRole('columnheader')).toHaveText([
		'Operating system',
		'Visits',
		'Share'
	]);
	await expect(browsers.getByRole('rowheader', { name: 'Other', exact: true })).toBeVisible();
	const overviewLink = page
		.getByRole('navigation', { name: 'Administration', exact: true })
		.getByRole('link', { name: 'Goto', exact: true });
	await expect(overviewLink).toHaveAttribute('href', '/admin?period=all');
	await expect(page.getByRole('link', { name: 'Overview', exact: true })).toHaveCount(0);
	await expect(graph).toHaveAttribute('aria-busy', 'false');
	await expect(graph).toHaveAccessibleName(/^Visits by week\. Total: 3\./);
	await expect(timeframe.getByRole('button', { name: '3 months', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('3');
	await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText([
		'Links',
		'Visits',
		'Invalid clicks'
	]);
	await expect(
		page.getByRole('region', { name: 'Invalid clicks', exact: true }).locator('.admin-stat-value')
	).toHaveText('1');
	const linksInventory = page.getByRole('region', { name: 'Links on go.example.org', exact: true });
	const domainDetails = page.getByRole('region', { name: 'Details', exact: true });
	const rootRow = linksInventory.getByRole('listitem').filter({
		has: page.getByRole('link', { name: '(root)', exact: true })
	});
	const rootLink = rootRow.getByRole('link', { name: '(root)', exact: true });
	await expect(rootRow.locator('.admin-inventory-secondary')).toHaveText('[not found]');
	await expect(rootRow.locator('.admin-inventory-state')).toHaveText('Active');
	const columns = ['Path', 'Destination', 'State', 'Visits'];
	await expect(linksInventory.locator('.admin-inventory-heading > span')).toHaveText(columns);
	const retainedLink = linksInventory
		.getByRole('listitem')
		.filter({ has: page.getByRole('link', { name: '/a%2Fb', exact: true }) });
	await expect(retainedLink.getByRole('link')).toHaveCount(1);
	const retainedVisits = retainedLink.locator('.admin-inventory-number');
	await expect(retainedVisits).toHaveText('1');
	await page.setViewportSize({ width: 390, height: 844 });
	const mobileTimeframe = page.getByRole('button', { name: /^Timeframe: / });
	await expect(mobileTimeframe).toContainText('3 months');
	await mobileTimeframe.click();
	await page
		.getByRole('listbox', { name: 'Timeframe', exact: true })
		.getByRole('option', { name: '30 days', exact: true })
		.click();
	await expect(visitsValue).toHaveText('2');
	await expect(retainedVisits).toHaveText('0');
	await expect(graph).toHaveAccessibleName(/^Visits by day\. Total: 2\./);
	expect(
		await linksInventory.evaluate((element) => element.scrollWidth <= element.clientWidth)
	).toBe(true);
	await page.setViewportSize({ width: 1280, height: 720 });
	await timeframe.getByRole('button', { name: '3 months', exact: true }).click();
	await expect(visitsValue).toHaveText('3');
	await expect(retainedVisits).toHaveText('1');
	await expect(graph).toHaveAccessibleName(/^Visits by week\. Total: 3\./);
	const historicalInvalid = linksInventory
		.getByRole('listitem')
		.filter({ has: page.getByRole('link', { name: '/a/b', exact: true }) });
	await expect(historicalInvalid.locator('.admin-inventory-number')).toHaveText('0');
	await expect(domainDetails.getByRole('heading', { name: 'Details', exact: true })).toBeVisible();
	await expect(domainDetails.locator('dt')).toHaveText(['Domain', 'Root', 'Fallback']);
	await expect(domainDetails.locator('dd')).toHaveText([
		'go.example.org',
		'Uses fallback',
		'404 Not found'
	]);
	await expect(rootRow.locator('.admin-inventory-number')).toHaveText('1');
	await expect(domainDetails.getByRole('link', { name: 'Root', exact: true })).toHaveCount(0);
	await expect(domainDetails.getByRole('link', { name: 'Fallback', exact: true })).toHaveCount(0);
	await expect(
		linksInventory.getByText('https://example.org/first-domain', { exact: true })
	).toBeVisible();
	await expect(
		linksInventory.getByRole('link', { name: 'https://example.org/first-domain', exact: true })
	).toHaveCount(0);
	await expect(rootLink).toHaveAttribute('href', '/admin/domains/go.example.org/links?period=all');

	const redirectCard = page.getByRole('region', { name: 'Redirect', exact: true });
	const settingsCard = page.getByRole('region', { name: 'Settings', exact: true });
	const docsPath = '/admin/domains/go.example.org/links/docs';
	await page.getByRole('link', { name: '/docs', exact: true }).click();
	await expect(page).toHaveURL(`${appServer.origin}${docsPath}?period=all`);
	await expect(page.getByRole('heading', { name: 'Link', exact: true })).toBeVisible();
	await expect(context).toHaveCount(0);
	await expect(redirectCard.getByRole('heading', { name: 'Redirect', exact: true })).toBeVisible();
	await expect(redirectCard.locator('dt')).toHaveText([
		'Domain',
		'Path',
		'Destination',
		'Rules',
		'Visits'
	]);
	await expect(settingsCard.locator('dt')).toHaveText([
		'HTTP status',
		'Case insensitive',
		'Trailing slash',
		'Path forwarding',
		'Query forwarding',
		'Starts',
		'Expires',
		'Tags'
	]);
	await expect(settingsCard.locator('time').first()).toBeVisible();
	await expect(settingsCard.locator('time').first()).toHaveAttribute(
		'datetime',
		'2020-01-01T00:00:00Z'
	);
	await expect(settingsCard.locator('time').last()).toHaveAttribute(
		'datetime',
		'2100-01-01T00:00:00Z'
	);
	await expect(
		settingsCard.getByRole('list', { name: 'Tags', exact: true }).getByRole('link')
	).toHaveText(['work', 'docs', sharedTag]);
	await expect(settingsCard.getByRole('link', { name: sharedTag, exact: true })).toHaveAttribute(
		'href',
		`${tagPath}?period=all`
	);
	const destinations = redirectCard.getByRole('list', { name: 'Destinations', exact: true });
	await expect(destinations.getByRole('link')).toHaveText([
		'https://example.org/french-linux',
		'https://example.org/french',
		'https://example.org/ios',
		'https://example.org/first-domain'
	]);
	await expect(
		redirectCard.getByRole('list', { name: 'Rules', exact: true }).locator('.setting-value')
	).toHaveText(['language fr AND OS linux', 'language fr', 'OS ios', 'default']);
	const domainField = redirectCard.locator('dd').first();
	await expect(domainField).toHaveText('go.example.org');
	await expect(domainField.getByRole('link')).toHaveAttribute(
		'href',
		'/admin/domains/go.example.org?period=all'
	);
	await expect(redirectCard.locator('dd').nth(1)).toHaveText('/docs');
	await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText(['Visits', 'Status']);
	await expect(page.getByRole('region', { name: 'Status', exact: true })).toContainText('Active');
	await expect(page).toHaveTitle('Link — go.example.org/docs — Goto');
	await expect(graph).toHaveAttribute('aria-busy', 'false');
	await expect(chartTable).toHaveAccessibleName('Visits');
	await expect(graph).toHaveAccessibleName(/^Visits by week\. Total: 1\./);
	await expect(browsers.getByRole('row', { name: 'Firefox 1 100%', exact: true })).toBeVisible();
	await expect(
		acceptedLanguages.getByRole('row', { name: 'en 1 100%', exact: true })
	).toBeVisible();
	await expect(
		acceptedLanguages.getByRole('row', { name: 'fr 1 100%', exact: true })
	).toBeVisible();
	const languageData = acceptedLanguages.getByRole('region', {
		name: 'Accepted languages data',
		exact: true
	});
	const sixthLanguage = acceptedLanguages.getByRole('row', { name: 'pt 1 100%', exact: true });
	await languageData.scrollIntoViewIfNeeded();
	await expect(
		acceptedLanguages.getByRole('row', { name: 'de 1 100%', exact: true })
	).toBeInViewport();
	await expect(sixthLanguage).not.toBeInViewport();
	await sixthLanguage.scrollIntoViewIfNeeded();
	await expect(sixthLanguage).toBeInViewport();
	await expect(
		operatingSystems.getByRole('row', { name: 'Linux 1 100%', exact: true })
	).toBeVisible();
	await expect(visitsValue).toHaveText('1');
	await timeframe.getByRole('button', { name: '7 days', exact: true }).click();
	await expect(visitsValue).toHaveText('0');
	await expect(graph).toHaveAccessibleName(/^Visits by day\. Total: 0\./);
	await expect(browsers).toContainText('No visits in this period.');
	await expect(operatingSystems).toContainText('No visits in this period.');
	await expect(acceptedLanguages).toContainText('No visits in this period.');
	await expect(chartTable.getByRole('row', { name: 'Total 0', exact: true })).toBeVisible();
	await timeframe.getByRole('button', { name: '3 months', exact: true }).click();
	await expect(visitsValue).toHaveText('1');
	await expect(overviewLink).toHaveAttribute('href', '/admin?period=all');
	await expect(
		page.getByRole('region', { name: 'Links on go.example.org', exact: true })
	).toHaveCount(0);

	await settingsCard.getByRole('link', { name: sharedTag, exact: true }).click();
	await expect(page).toHaveURL(`${appServer.origin}${tagPath}?period=all`);
	const tagHeading = page.getByRole('heading', { name: `Tag: ${sharedTag}`, exact: true });
	await expect(tagHeading).toBeVisible();
	await expect(tagHeading).toHaveAttribute('title', `Tag: ${sharedTag}`);
	await expect(page).toHaveTitle(`Tag: ${sharedTag} — Goto`);
	await expect(page.getByRole('region', { name: 'Tag details', exact: true })).toHaveCount(0);
	const taggedLinks = page.getByRole('region', { name: `Links tagged ${sharedTag}`, exact: true });
	await expect(taggedLinks.getByRole('link')).toHaveCount(2);
	await expect(taggedLinks.locator('.admin-inventory-heading > span')).toHaveText([
		'Domain',
		'Path',
		'State',
		'Visits'
	]);
	const taggedDocs = taggedLinks.getByRole('link', { name: 'go.example.org/docs', exact: true });
	await expect(taggedDocs.locator('.admin-inventory-primary')).toHaveText('go.example.org');
	await expect(taggedDocs.locator('.admin-inventory-secondary')).toHaveText('/docs');
	await expect(taggedDocs).toHaveAttribute('href', `${docsPath}?period=all`);
	await expect(
		taggedLinks.getByRole('link', { name: 'tiny.example.org/docs', exact: true })
	).toBeVisible();
	await expect(visitsValue).toHaveText('2');
	await expect(acceptedLanguages).toBeVisible();
	await timeframe.getByRole('button', { name: '7 days', exact: true }).click();
	await expect(page).toHaveURL(`${appServer.origin}${tagPath}?period=7d`);
	await expect(visitsValue).toHaveText('1');
	await taggedDocs.click();
	await expect(page).toHaveURL(`${appServer.origin}${docsPath}?period=7d`);
	await timeframe.getByRole('button', { name: '3 months', exact: true }).click();

	await overviewLink.click();
	await domainLink.click();
	await page.getByRole('link', { name: '/a%2Fb', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Link', exact: true })).toBeVisible();
	await expect(page).toHaveTitle('Link — go.example.org/a%2Fb — Goto');
	await expect(page).toHaveURL(
		`${appServer.origin}/admin/domains/go.example.org/links/a%252Fb?period=all`
	);
	await expect(visitsValue).toHaveText('1');
	await page.goBack();
	await page.getByRole('link', { name: '/a/b', exact: true }).click();
	await expect(page).toHaveURL(
		`${appServer.origin}/admin/domains/go.example.org/links/a/b?period=all`
	);
	await expect(page.getByRole('heading', { name: 'Link', exact: true })).toBeVisible();
	await expect(page).toHaveTitle('Link — go.example.org/a/b — Goto');
	await expect(visitsValue).toHaveText('0');

	await page.goBack();
	await rootLink.click();
	await expect(page).toHaveURL(`${appServer.origin}/admin/domains/go.example.org/links?period=all`);
	await expect(page.getByRole('heading', { name: 'Root', exact: true })).toBeVisible();
	await expect(page).toHaveTitle('Root — go.example.org — Goto');
	await expect(acceptedLanguages).toBeVisible();
	await expect(visitsValue).toHaveText('1');
	await expect(page.getByRole('region', { name: 'Status', exact: true })).toHaveCount(0);
	const rootDetails = page.getByRole('region', { name: 'Root details', exact: true });
	await expect(rootDetails.locator('dd')).toHaveText([
		'go.example.org',
		'go.example.org/',
		'1',
		'Uses fallback'
	]);
	await expect(page.getByRole('region', { name: 'Fallback', exact: true })).toContainText(
		'404 Not found'
	);
	await rootDetails.getByRole('link', { name: 'go.example.org', exact: true }).click();
	await expect(timeframe.getByRole('button', { name: '3 months', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('3');

	await page
		.getByRole('navigation', { name: 'Administration', exact: true })
		.getByRole('link', { name: 'Health', exact: true })
		.click();
	await expect(page).toHaveURL(`${appServer.origin}/admin/health`);
	await expect(page.getByRole('heading', { name: 'Health', exact: true })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Application', exact: true })).toContainText(
		'Shared credentials'
	);
	await expect(
		page.getByRole('region', { name: 'Analytics', exact: true }).getByRole('alert')
	).toHaveCount(0);
	await expect(
		page
			.getByRole('region', { name: 'Tags', exact: true })
			.getByRole('link', { name: sharedTag, exact: true })
	).toHaveCount(1);
	const workerHealth = page.getByRole('region', { name: 'Worker', exact: true });
	await expect(workerHealth.getByRole('status')).toHaveText('Not checked');
	await workerHealth.getByRole('button', { name: 'Test worker', exact: true }).click();
	await expect(workerHealth.getByRole('alert')).toContainText('Worker is reachable.');
	await expect(workerHealth.locator('time')).toBeVisible();

	const html = await page.content();
	await expect(html).not.toContain('e2e-only-password');
	await page.getByRole('button', { name: 'Sign out', exact: true }).click();
	await expect(page).toHaveURL(/\/signin\?/);
	await page.goto(`${appServer.origin}${docsPath}`);
	await expect(page).toHaveURL(/\/signin\?/);
	await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
});

test.describe('analytics disabled', () => {
	test.use({ withWorker: false, retentionMonths: 0 });

	test('disabled analytics keeps inventory and settings usable without traffic controls', async ({
		page,
		appServer
	}) => {
		await page.goto(`${appServer.origin}/admin`);
		await page.getByLabel('Username', { exact: true }).fill('example');
		await page.getByLabel('Password', { exact: true }).fill('e2e-only-password');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
		await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText(['Domains', 'Links']);
		await expect(page.getByRole('group', { name: 'Timeframe', exact: true })).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Browsers', exact: true })).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Operating systems', exact: true })).toHaveCount(
			0
		);
		await expect(page.getByRole('region', { name: 'Accepted languages', exact: true })).toHaveCount(
			0
		);
		await expect(page.getByRole('region', { name: 'Visits over time', exact: true })).toHaveCount(
			0
		);
		await expect(
			page
				.getByRole('region', { name: 'Domain inventory', exact: true })
				.locator('.admin-inventory-heading > span')
		).toHaveText(['Host', 'Links']);
		await expect(page.getByRole('status')).toHaveText('Analytics disabled.');
		await page.getByRole('link', { name: 'go.example.org', exact: true }).click();
		await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText(['Links']);
		await expect(page.getByRole('group', { name: 'Timeframe', exact: true })).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Accepted languages', exact: true })).toHaveCount(
			0
		);
		await expect(page.getByRole('region', { name: 'Visits over time', exact: true })).toHaveCount(
			0
		);
		await expect(
			page
				.getByRole('region', { name: 'Links on go.example.org', exact: true })
				.locator('.admin-inventory-heading > span')
		).toHaveText(['Path', 'Destination', 'State']);
		await expect(
			page.getByRole('region', { name: 'Details', exact: true }).locator('dt')
		).toHaveText(['Domain', 'Root', 'Fallback']);
		await expect(
			page
				.getByRole('region', { name: 'Links on go.example.org', exact: true })
				.getByRole('link', { name: '(root)', exact: true })
		).toBeVisible();
		await page.getByRole('link', { name: '/docs', exact: true }).click();
		await expect(page.getByRole('region', { name: 'Redirect', exact: true })).toBeVisible();
		await expect(page.getByRole('region', { name: 'Browsers', exact: true })).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Operating systems', exact: true })).toHaveCount(
			0
		);
		await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText(['Status']);
		await expect(page.getByRole('region', { name: 'Status', exact: true })).toContainText('Active');
		await expect(page.getByRole('group', { name: 'Timeframe', exact: true })).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Accepted languages', exact: true })).toHaveCount(
			0
		);
		await expect(page.getByRole('region', { name: 'Visits over time', exact: true })).toHaveCount(
			0
		);
		await page
			.getByRole('navigation', { name: 'Administration', exact: true })
			.getByRole('link', { name: 'Health', exact: true })
			.click();
		await expect(
			page.getByRole('region', { name: 'Analytics', exact: true }).locator('dd')
		).toHaveText(['Disabled', 'Disabled', 'Disabled']);
		await expect(
			page.getByRole('region', { name: 'Analytics', exact: true }).getByRole('alert')
		).toHaveCount(0);
		await expect(
			page.getByRole('region', { name: 'Worker', exact: true }).getByRole('status')
		).toHaveText('Not checked');
		await page
			.getByRole('region', { name: 'Tags', exact: true })
			.getByRole('link', { name: sharedTag, exact: true })
			.click();
		await expect(page).toHaveURL(`${appServer.origin}${tagPath}`);
		await expect(
			page.getByRole('heading', { name: `Tag: ${sharedTag}`, exact: true })
		).toBeVisible();
		await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText(['Links']);
		await expect(page.getByRole('group', { name: 'Timeframe', exact: true })).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Accepted languages', exact: true })).toHaveCount(
			0
		);
		await expect(page.getByRole('region', { name: 'Visits over time', exact: true })).toHaveCount(
			0
		);
		const taggedLinks = page.getByRole('region', {
			name: `Links tagged ${sharedTag}`,
			exact: true
		});
		await expect(taggedLinks.getByRole('link')).toHaveCount(2);
		await expect(taggedLinks.locator('.admin-inventory-heading > span')).toHaveText([
			'Domain',
			'Path',
			'State'
		]);
	});
});
