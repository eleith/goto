import type { Request } from '@playwright/test';
import { expect, test } from './support/test.ts';

test.use({ withWorker: true });

test('shared credentials protect overview, domain and link pages and sign-out removes access', async ({
	page,
	appServer
}) => {
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
	const retentionValue = page
		.getByRole('region', { name: 'Retention', exact: true })
		.locator('.admin-stat-value');
	await expect(retentionValue).toHaveText('3 months');
	await expect(page.locator('.admin-cards').getByRole('region')).toHaveCount(4);
	const heading = page.locator('.admin-heading');
	await expect(heading.locator('.admin-title > h1 + time')).toBeVisible();
	const timeframe = heading.getByRole('group', { name: 'Timeframe', exact: true });
	await expect(timeframe.getByRole('button')).toHaveText(['7 days', '30 days', '3 months']);
	await expect(timeframe.getByRole('button', { name: '30 days', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const trend = page.getByRole('region', { name: 'Visits over time', exact: true });
	await expect(trend).toHaveAttribute('aria-busy', 'false');
	const graph = trend.getByRole('img');
	await expect(graph).toBeVisible();
	await expect(graph).toHaveAccessibleName(/^Valid visits by day\. Total: 2\./);
	const domainLink = page.getByRole('link', { name: 'go.example.org', exact: true });
	const domainRow = page.getByRole('row').filter({ has: domainLink });
	await expect(domainRow.getByRole('cell')).toHaveText(['6', '1']);
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
	await expect(domainRow.getByRole('cell')).toHaveText(['6', '0']);
	await expect(graph).toHaveAccessibleName(/^Valid visits by day\. Total: 1\./);
	await timeframe.getByRole('button', { name: '3 months', exact: true }).click();
	await expect(timeframe.getByRole('button', { name: '3 months', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('3');
	await expect(domainRow.getByRole('cell')).toHaveText(['6', '2']);
	await expect(graph).toHaveAccessibleName(/^Valid visits by week\. Total: 3\./);
	await page.goBack();
	await expect(timeframe.getByRole('button', { name: '7 days', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('1');
	await expect(domainRow.getByRole('cell')).toHaveText(['6', '0']);
	await expect(graph).toHaveAccessibleName(/^Valid visits by day\. Total: 1\./);
	await page.goForward();
	await expect(timeframe.getByRole('button', { name: '3 months', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(visitsValue).toHaveText('3');
	await expect(domainRow.getByRole('cell')).toHaveText(['6', '2']);
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
	await expect(page.getByRole('heading', { name: 'go.example.org', exact: true })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Visits over time', exact: true })).toHaveCount(0);
	await expect(visitsValue).toHaveText('2');
	await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText([
		'Links',
		'Valid visits',
		'Invalid clicks',
		'Retention'
	]);
	await expect(
		page.getByRole('region', { name: 'Invalid clicks', exact: true }).locator('.admin-stat-value')
	).toHaveText('1');
	const linksTable = page.getByRole('region', { name: 'Links on go.example.org', exact: true });
	const baseTable = page.getByRole('region', { name: 'Base URL on go.example.org', exact: true });
	const columns = ['Path', 'Destination', 'State', 'Visits'];
	await expect(linksTable.getByRole('columnheader')).toHaveText(columns);
	const historicalInvalid = linksTable
		.getByRole('row')
		.filter({ has: page.getByRole('link', { name: '/a/b', exact: true }) });
	await expect(historicalInvalid.getByRole('cell').last()).toHaveText('0');
	await expect(baseTable.getByRole('columnheader')).toHaveText(columns);
	await expect(baseTable.getByRole('cell')).toHaveText(['404 Not found', 'Fallback', '0']);
	await expect(
		linksTable.getByRole('link', { name: 'https://example.org/first-domain', exact: true })
	).toBeVisible();

	const domainBreadcrumb = page
		.getByRole('navigation', { name: 'Breadcrumb', exact: true })
		.getByRole('link', { name: 'go.example.org', exact: true });
	const docsPath = '/admin/domains/go.example.org/links/docs';
	await page.getByRole('link', { name: '/docs', exact: true }).click();
	await expect(page).toHaveURL(`${appServer.origin}${docsPath}`);
	await expect(page.getByRole('heading', { name: '/docs', exact: true })).toBeVisible();
	await expect(visitsValue).toHaveText('1');
	await expect(
		page.getByRole('region', { name: 'Links on go.example.org', exact: true })
	).toHaveCount(0);

	await domainBreadcrumb.click();
	await page.getByRole('link', { name: '/a%2Fb', exact: true }).click();
	await expect(page.getByRole('heading', { name: '/a%2Fb', exact: true })).toBeVisible();
	await expect(page).toHaveURL(`${appServer.origin}/admin/domains/go.example.org/links/a%252Fb`);
	await expect(visitsValue).toHaveText('1');
	await domainBreadcrumb.click();
	await page.getByRole('link', { name: '/a/b', exact: true }).click();
	await expect(page).toHaveURL(`${appServer.origin}/admin/domains/go.example.org/links/a/b`);
	await expect(page.getByRole('heading', { name: '/a/b', exact: true })).toBeVisible();
	await expect(visitsValue).toHaveText('0');

	await domainBreadcrumb.click();
	await baseTable.getByRole('link', { name: '/', exact: true }).click();
	await expect(page).toHaveURL(`${appServer.origin}/admin/domains/go.example.org/links`);
	await expect(page.getByRole('heading', { name: '/', exact: true })).toBeVisible();
	await expect(visitsValue).toHaveText('0');
	await domainBreadcrumb.click();
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
			page.getByRole('region', { name: 'Domain inventory', exact: true }).getByRole('columnheader')
		).toHaveText(['Domain', 'Links']);
		await expect(page.getByRole('status')).toHaveText('Analytics disabled.');
	});
});
