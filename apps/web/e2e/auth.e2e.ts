import type { Request } from '@playwright/test';
import { expect, test } from './support/test.ts';

test.use({ withWorker: true });

test('shared credentials protect overview, domain and link pages and sign-out removes access', async ({
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
		.getByRole('region', { name: 'Valid visits', exact: true })
		.locator('.admin-stat-value');
	await expect(page.getByRole('region', { name: 'Domains', exact: true })).toContainText('2');
	await expect(visitsValue).toHaveText('2');
	await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText([
		'Domains',
		'Links',
		'Valid visits'
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
	await expect(chartTable).toHaveAccessibleName('Valid visits');
	await expect(chartTable.getByRole('columnheader')).toHaveText(['Period (UTC)', 'Valid visits']);
	await expect(chartTable.getByRole('row', { name: 'Total 2', exact: true })).toBeVisible();
	await expect(chartTable).not.toContainText('(partial)');
	await expect(trend.getByRole('region', { name: 'Visit data', exact: true })).toHaveAttribute(
		'tabindex',
		'0'
	);
	await expect(graph).toBeVisible();
	await expect(graph).toHaveAccessibleName(/^Valid visits by day\. Total: 2\./);
	const domainLink = page.getByRole('link', { name: 'go.example.org', exact: true });
	const domainRow = page.getByRole('listitem').filter({ has: domainLink });
	const domainCounts = domainRow.locator('.admin-inventory-number');
	await expect(domainCounts).toHaveText(['6', '1']);
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
	await expect(visitsValue).toHaveText('1');
	await expect(domainCounts).toHaveText(['6', '0']);
	await expect(graph).toHaveAccessibleName(/^Valid visits by day\. Total: 1\./);
	await timeframe.getByRole('button', { name: '3 months', exact: true }).click();
	await expect(timeframe.getByRole('button', { name: '3 months', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('3');
	await expect(domainCounts).toHaveText(['6', '2']);
	await expect(graph).toHaveAccessibleName(/^Valid visits by week\. Total: 3\./);
	await page.goBack();
	await expect(timeframe.getByRole('button', { name: '7 days', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('1');
	await expect(domainCounts).toHaveText(['6', '0']);
	await expect(graph).toHaveAccessibleName(/^Valid visits by day\. Total: 1\./);
	await page.goForward();
	await expect(timeframe.getByRole('button', { name: '3 months', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('3');
	await expect(domainCounts).toHaveText(['6', '2']);
	await expect(graph).toHaveAccessibleName(/^Valid visits by week\. Total: 3\./);
	page.off('request', recordSelectionRequest);
	expect(selectionRequests).toEqual([]);
	await page.reload();
	await expect(timeframe.getByRole('button', { name: '3 months', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('3');
	await expect(graph).toHaveAccessibleName(/^Valid visits by week\. Total: 3\./);
	expect(navigationWarnings).toEqual([]);
	await domainLink.click();
	await expect(page.getByRole('heading', { name: 'Domain', exact: true })).toBeVisible();
	const context = page.locator('.admin-context');
	await expect(context).toHaveText('go.example.org');
	await expect(page).toHaveTitle('Domain — go.example.org — Goto');
	const overviewLink = page
		.getByRole('navigation', { name: 'Administration', exact: true })
		.getByRole('link');
	await expect(overviewLink).toHaveAttribute('href', '/admin?period=all');
	await expect(page.getByRole('link', { name: 'Overview', exact: true })).toHaveCount(0);
	await expect(graph).toHaveAttribute('aria-busy', 'false');
	await expect(graph).toHaveAccessibleName(/^Valid visits by week\. Total: 2\./);
	await expect(timeframe.getByRole('button', { name: '3 months', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('2');
	await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText([
		'Links',
		'Valid visits',
		'Invalid clicks'
	]);
	await expect(
		page.getByRole('region', { name: 'Invalid clicks', exact: true }).locator('.admin-stat-value')
	).toHaveText('1');
	const linksInventory = page.getByRole('region', { name: 'Links on go.example.org', exact: true });
	const baseInventory = page.getByRole('region', {
		name: 'Base URL on go.example.org',
		exact: true
	});
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
	await expect(visitsValue).toHaveText('1');
	await expect(retainedVisits).toHaveText('0');
	await expect(graph).toHaveAccessibleName(/^Valid visits by day\. Total: 1\./);
	expect(
		await linksInventory.evaluate((element) => element.scrollWidth <= element.clientWidth)
	).toBe(true);
	await page.setViewportSize({ width: 1280, height: 720 });
	await timeframe.getByRole('button', { name: '3 months', exact: true }).click();
	await expect(visitsValue).toHaveText('2');
	await expect(retainedVisits).toHaveText('1');
	await expect(graph).toHaveAccessibleName(/^Valid visits by week\. Total: 2\./);
	expect(await cardSizes()).toEqual(overviewCardSizes);
	const historicalInvalid = linksInventory
		.getByRole('listitem')
		.filter({ has: page.getByRole('link', { name: '/a/b', exact: true }) });
	await expect(historicalInvalid.locator('.admin-inventory-number')).toHaveText('0');
	await expect(baseInventory.locator('.admin-inventory-heading > span')).toHaveText(columns);
	await expect(
		baseInventory.locator(
			'.admin-inventory-secondary, .admin-inventory-state, .admin-inventory-number'
		)
	).toHaveText(['404 Not found', 'Fallback', '0']);
	await expect(
		linksInventory.getByText('https://example.org/first-domain', { exact: true })
	).toBeVisible();
	await expect(
		linksInventory.getByRole('link', { name: 'https://example.org/first-domain', exact: true })
	).toHaveCount(0);
	await expect(baseInventory.getByRole('link')).toHaveCount(1);

	const linkDetails = page.getByRole('region', { name: 'Link details', exact: true });
	const domainDetailsLink = linkDetails.getByRole('link', { name: 'go.example.org', exact: true });
	const docsPath = '/admin/domains/go.example.org/links/docs';
	await page.getByRole('link', { name: '/docs', exact: true }).click();
	await expect(page).toHaveURL(`${appServer.origin}${docsPath}?period=all`);
	await expect(page.getByRole('heading', { name: 'Link', exact: true })).toBeVisible();
	await expect(context).toHaveCount(0);
	await expect(
		linkDetails.getByRole('heading', { name: 'Link details', exact: true })
	).toBeVisible();
	await expect(linkDetails.locator('dt')).toHaveText(['Domain', 'Path', 'Destination']);
	await expect(linkDetails.locator('dd').nth(1)).toHaveText('/docs');
	await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText([
		'Valid visits',
		'Status'
	]);
	await expect(page.getByRole('region', { name: 'Status', exact: true })).toContainText('Active');
	expect(await cardSizes()).toEqual(overviewCardSizes.slice(0, 2));
	await expect(page).toHaveTitle('Link — go.example.org/docs — Goto');
	await expect(graph).toHaveAttribute('aria-busy', 'false');
	await expect(chartTable).toHaveAccessibleName('Valid visits');
	await expect(graph).toHaveAccessibleName(/^Valid visits by week\. Total: 1\./);
	await expect(visitsValue).toHaveText('1');
	await timeframe.getByRole('button', { name: '7 days', exact: true }).click();
	await expect(visitsValue).toHaveText('0');
	await expect(graph).toHaveAccessibleName(/^Valid visits by day\. Total: 0\./);
	await expect(chartTable.getByRole('row', { name: 'Total 0', exact: true })).toBeVisible();
	await timeframe.getByRole('button', { name: '3 months', exact: true }).click();
	await expect(visitsValue).toHaveText('1');
	await expect(domainDetailsLink).toHaveAttribute(
		'href',
		'/admin/domains/go.example.org?period=all'
	);
	await expect(
		page.getByRole('region', { name: 'Links on go.example.org', exact: true })
	).toHaveCount(0);

	await domainDetailsLink.click();
	await page.getByRole('link', { name: '/a%2Fb', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Link', exact: true })).toBeVisible();
	await expect(page).toHaveTitle('Link — go.example.org/a%2Fb — Goto');
	await expect(page).toHaveURL(
		`${appServer.origin}/admin/domains/go.example.org/links/a%252Fb?period=all`
	);
	await expect(visitsValue).toHaveText('1');
	await domainDetailsLink.click();
	await page.getByRole('link', { name: '/a/b', exact: true }).click();
	await expect(page).toHaveURL(
		`${appServer.origin}/admin/domains/go.example.org/links/a/b?period=all`
	);
	await expect(page.getByRole('heading', { name: 'Link', exact: true })).toBeVisible();
	await expect(page).toHaveTitle('Link — go.example.org/a/b — Goto');
	await expect(visitsValue).toHaveText('0');

	await domainDetailsLink.click();
	await baseInventory.getByRole('link', { name: '/', exact: true }).click();
	await expect(page).toHaveURL(`${appServer.origin}/admin/domains/go.example.org/links?period=all`);
	await expect(page.getByRole('heading', { name: 'Link', exact: true })).toBeVisible();
	await expect(page).toHaveTitle('Link — go.example.org/ — Goto');
	await expect(visitsValue).toHaveText('0');
	await domainDetailsLink.click();
	await expect(timeframe.getByRole('button', { name: '3 months', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('2');

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

	test('overview remains inventory-only without analytics controls or columns', async ({
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
			page
				.getByRole('region', { name: 'Base URL on go.example.org', exact: true })
				.locator('.admin-inventory-heading > span')
		).toHaveText(['Path', 'Destination', 'State']);
		await page.getByRole('link', { name: '/docs', exact: true }).click();
		await expect(page.getByRole('region', { name: 'Link details', exact: true })).toBeVisible();
		await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText(['Status']);
		await expect(page.getByRole('region', { name: 'Status', exact: true })).toContainText('Active');
		await expect(page.getByRole('group', { name: 'Timeframe', exact: true })).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Visits over time', exact: true })).toHaveCount(
			0
		);
	});
});
