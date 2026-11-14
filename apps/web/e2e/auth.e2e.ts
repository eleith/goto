import type { Request } from '@playwright/test';
import { expect, test } from './support/test.ts';

test.use({ withWorker: true });

test('shared credentials protect admin pages and sign-out removes access', async ({
	page,
	appServer
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	const cardSizes = () =>
		page.locator('.admin-stat').evaluateAll((cards) =>
			cards.map((card) => {
				const { width, height } = card.getBoundingClientRect();
				return { width, height };
			})
		);
	const navigationWarnings: string[] = [];
	page.on('console', (message) => {
		const text = message.text();
		if (text.includes('push_state_deprecated')) navigationWarnings.push(text);
	});
	await page.goto(`${appServer.origin}/admin`);
	await expect(page).toHaveURL(/\/signin\?/);
	await page.getByLabel('Username', { exact: true }).fill('example');
	await page.getByLabel('Password', { exact: true }).fill('incorrect');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Invalid username or password');

	await page.getByLabel('Password', { exact: true }).fill('e2e-only-password');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
	const visitsValue = page
		.getByRole('region', { name: 'Visits', exact: true })
		.locator('.admin-stat-value');
	await expect(page.getByRole('region', { name: 'Domains', exact: true })).toContainText('2');
	await expect(visitsValue).toHaveText('3');
	await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText([
		'Domains',
		'Links',
		'Visits',
		'Retention'
	]);
	const overviewCardSizes = await cardSizes();
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
	await expect(domainRow.locator('.admin-inventory-label').first()).toHaveCSS(
		'clip-path',
		'inset(50%)'
	);
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
	await page.reload();
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
	const browsers = page.getByRole('region', { name: 'Browsers', exact: true });
	const operatingSystems = page.getByRole('region', { name: 'Operating systems', exact: true });
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
	const domainDetails = page.getByRole('region', { name: 'Domain details', exact: true });
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
	await expect(retainedLink.locator('.admin-inventory-label')).toHaveCSS('clip-path', 'inset(50%)');
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(retainedLink.locator('.admin-inventory-label')).toHaveCSS('clip-path', 'none');
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
	expect(await cardSizes()).toEqual(overviewCardSizes.slice(0, 3));
	const historicalInvalid = linksInventory
		.getByRole('listitem')
		.filter({ has: page.getByRole('link', { name: '/a/b', exact: true }) });
	await expect(historicalInvalid.locator('.admin-inventory-number')).toHaveText('0');
	await expect(
		domainDetails.getByRole('heading', { name: 'Domain details', exact: true })
	).toBeVisible();
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

	const linkDetails = page.getByRole('region', { name: 'Link details', exact: true });
	const docsPath = '/admin/domains/go.example.org/links/docs';
	await page.getByRole('link', { name: '/docs', exact: true }).click();
	await expect(page).toHaveURL(`${appServer.origin}${docsPath}?period=all`);
	await expect(page.getByRole('heading', { name: 'Link', exact: true })).toBeVisible();
	await expect(context).toHaveCount(0);
	await expect(
		linkDetails.getByRole('heading', { name: 'Link details', exact: true })
	).toBeVisible();
	await expect(linkDetails.locator('dt')).toHaveText([
		'Link',
		'Destination',
		'HTTP status',
		'Case insensitive',
		'Trailing slash',
		'Path forwarding',
		'Query forwarding',
		'Starts',
		'Expires',
		'Tags'
	]);
	await expect(linkDetails.locator('time').first()).toBeVisible();
	await expect(linkDetails.locator('time').first()).toHaveAttribute(
		'datetime',
		'2020-01-01T00:00:00Z'
	);
	await expect(linkDetails.locator('time').last()).toHaveAttribute(
		'datetime',
		'2100-01-01T00:00:00Z'
	);
	await expect(linkDetails.getByText('work, docs', { exact: true })).toBeVisible();
	const linkField = linkDetails.locator('dd').first();
	await expect(linkField).toHaveText('go.example.org/docs');
	await expect(linkField.getByRole('link')).toHaveCount(0);
	await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText(['Visits', 'Status']);
	await expect(page.getByRole('region', { name: 'Status', exact: true })).toContainText('Active');
	expect(await cardSizes()).toEqual(overviewCardSizes.slice(0, 2));
	await expect(page).toHaveTitle('Link — go.example.org/docs — Goto');
	await expect(graph).toHaveAttribute('aria-busy', 'false');
	await expect(chartTable).toHaveAccessibleName('Visits');
	await expect(graph).toHaveAccessibleName(/^Visits by week\. Total: 1\./);
	await expect(browsers.getByRole('row', { name: 'Firefox 1 100%', exact: true })).toBeVisible();
	await expect(
		operatingSystems.getByRole('row', { name: 'Linux 1 100%', exact: true })
	).toBeVisible();
	await expect(visitsValue).toHaveText('1');
	await timeframe.getByRole('button', { name: '7 days', exact: true }).click();
	await expect(visitsValue).toHaveText('0');
	await expect(graph).toHaveAccessibleName(/^Visits by day\. Total: 0\./);
	await expect(browsers).toContainText('No visits in this period.');
	await expect(operatingSystems).toContainText('No visits in this period.');
	await expect(chartTable.getByRole('row', { name: 'Total 0', exact: true })).toBeVisible();
	await timeframe.getByRole('button', { name: '3 months', exact: true }).click();
	await expect(visitsValue).toHaveText('1');
	await expect(overviewLink).toHaveAttribute('href', '/admin?period=all');
	await expect(
		page.getByRole('region', { name: 'Links on go.example.org', exact: true })
	).toHaveCount(0);

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
	await expect(visitsValue).toHaveText('1');
	await expect(page.getByRole('region', { name: 'Status', exact: true })).toHaveCount(0);
	const rootDetails = page.getByRole('region', { name: 'Root details', exact: true });
	await expect(rootDetails.locator('dd')).toHaveText([
		'go.example.org',
		'go.example.org/',
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
		await expect(page.getByRole('region', { name: 'Visits over time', exact: true })).toHaveCount(
			0
		);
		await expect(
			page
				.getByRole('region', { name: 'Domain inventory', exact: true })
				.locator('.admin-inventory-heading > span')
		).toHaveText(['Domain', 'Links']);
		await expect(page.getByRole('status')).toHaveText('Analytics disabled.');
		await page.getByRole('link', { name: 'go.example.org', exact: true }).click();
		await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText(['Links']);
		await expect(page.getByRole('group', { name: 'Timeframe', exact: true })).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Visits over time', exact: true })).toHaveCount(
			0
		);
		await expect(
			page
				.getByRole('region', { name: 'Links on go.example.org', exact: true })
				.locator('.admin-inventory-heading > span')
		).toHaveText(['Path', 'Destination', 'State']);
		await expect(
			page.getByRole('region', { name: 'Domain details', exact: true }).locator('dt')
		).toHaveText(['Domain', 'Root', 'Fallback']);
		await expect(
			page
				.getByRole('region', { name: 'Links on go.example.org', exact: true })
				.getByRole('link', { name: '(root)', exact: true })
		).toBeVisible();
		await page.getByRole('link', { name: '/docs', exact: true }).click();
		await expect(page.getByRole('region', { name: 'Link details', exact: true })).toBeVisible();
		await expect(page.getByRole('region', { name: 'Browsers', exact: true })).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Operating systems', exact: true })).toHaveCount(
			0
		);
		await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText(['Status']);
		await expect(page.getByRole('region', { name: 'Status', exact: true })).toContainText('Active');
		await expect(page.getByRole('group', { name: 'Timeframe', exact: true })).toHaveCount(0);
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
	});
});
