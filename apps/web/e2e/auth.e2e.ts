import type { Request } from '@playwright/test';
import { expect, test } from './support/test.ts';

test.use({ withWorker: true });

const sharedTag = 'Work/100%é';
const tagPath = '/admin/tags/Work%2F100%25%C3%A9';
const docsTitle = 'New hire handbook';

test('shared credentials protect admin pages and sign-out removes access', async ({
	page,
	request,
	appServer
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	const root = await request.get('/', { maxRedirects: 0 });
	expect(root.status()).toBe(404);
	expect(root.headers().location).toBeUndefined();

	const adminRedirect = await request.get('/admin/analytics', {
		headers: { accept: 'text/html' },
		maxRedirects: 0
	});
	expect(adminRedirect.status()).toBe(303);
	expect(adminRedirect.headers().location).toBe('/signin?callbackUrl=%2Fadmin%2Fanalytics');
	expect(adminRedirect.headers()['cache-control']).toBe('private, no-store');

	const signInPage = await page.goto(`${appServer.origin}/admin`);
	await expect(page).toHaveURL(/\/signin\?/);
	expect(signInPage?.headers()['cache-control']).toBe('private, no-store');
	await expect(page).toHaveTitle('Sign in — GoTo');
	await expect(page.getByRole('heading', { name: 'Sign in to GoTo', exact: true })).toBeVisible();
	await page.getByLabel('Username', { exact: true }).fill('example');
	await page.getByLabel('Password', { exact: true }).fill('incorrect');
	const failedSignIn = page.waitForResponse(`${appServer.origin}/auth/sign-in/credentials`);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	expect((await failedSignIn).headers()['cache-control']).toBe('private, no-store');
	await expect(page.getByRole('alert')).toContainText('Invalid username or password');

	await page.getByLabel('Password', { exact: true }).fill('e2e-only-password');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Domains', exact: true })).toContainText('2');
	const summary = page.getByRole('region', { name: 'Summary', exact: true });
	await expect(summary.locator('.admin-stat-label')).toHaveText([
		'Domains',
		'Links',
		'Total Visits',
		'Invalid clicks',
		'Root visits'
	]);
	const totalVisits = summary.getByRole('region', { name: 'Total Visits', exact: true });
	const invalidClicks = page.getByRole('region', { name: 'Invalid clicks', exact: true });
	const rootVisits = page.getByRole('region', { name: 'Root visits', exact: true });
	await expect(totalVisits.getByText('4', { exact: true })).toBeVisible();
	await expect(invalidClicks.locator('.admin-stat-value')).toHaveText('1');
	await expect(rootVisits.locator('.admin-stat-value')).toHaveText('1');
	await expect(summary.getByRole('link')).toHaveCount(0);
	await expect(page.getByRole('region', { name: 'Visits over time', exact: true })).toHaveCount(0);
	await expect(page.getByRole('region', { name: 'Accepted languages', exact: true })).toHaveCount(
		0
	);
	const heading = page.locator('.admin-heading');
	await expect(heading.locator('.admin-title > h1 + time')).toBeVisible();
	const timeframe = heading.getByRole('group', { name: 'Timeframe', exact: true });
	await expect(timeframe).toHaveCount(0);
	const domainLink = page.getByRole('link', { name: 'go.example.org', exact: true });
	const domainRow = page.getByRole('listitem').filter({ has: domainLink });
	await expect(domainRow.locator('.admin-inventory-number')).toHaveText(['6', '2']);
	const overviewResponse = await page.goto(`${appServer.origin}/admin?period=7d`);
	expect(overviewResponse?.headers()['cache-control']).toBe('private, no-store');
	await expect(totalVisits.getByText('4', { exact: true })).toBeVisible();
	const adminNav = page.getByRole('navigation', { name: 'Administration', exact: true });
	const overviewLink = adminNav.getByRole('link', { name: 'GoTo', exact: true });
	await expect(adminNav.getByText('GoTo', { exact: true })).toBeVisible();
	await expect(overviewLink).toHaveCount(0);
	await domainLink.click();
	await expect(page.getByRole('heading', { name: 'Domain', exact: true })).toBeVisible();
	const context = page.locator('.admin-context');
	await expect(context).toHaveCount(0);
	await expect(page).toHaveTitle('Domain — go.example.org — GoTo');
	await expect(timeframe).toHaveCount(0);
	const trend = page.getByRole('region', { name: 'Visits over time', exact: true });
	await expect(trend).toHaveCount(0);
	await expect(overviewLink).toHaveAttribute('href', '/admin');
	const appIcon = overviewLink.locator('img[src="/@static/favicon.svg"]');
	await expect(appIcon).toBeVisible();
	await expect
		.poll(() => appIcon.evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBeGreaterThan(0);
	await expect(page.getByRole('link', { name: 'Overview', exact: true })).toHaveCount(0);
	await expect(summary.locator('.admin-stat-label')).toHaveText([
		'Links',
		'Total Visits',
		'Invalid clicks',
		'Root visits'
	]);
	await expect(totalVisits.getByText('2', { exact: true })).toBeVisible();
	await expect(invalidClicks.locator('.admin-stat-value')).toHaveText('1');
	await expect(rootVisits.locator('.admin-stat-value')).toHaveText('1');
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
	const percentLinkRow = linksInventory
		.getByRole('listitem')
		.filter({ has: page.getByRole('link', { name: '/a%2Fb', exact: true }) });
	await expect(percentLinkRow.getByRole('link')).toHaveCount(1);
	await expect(percentLinkRow.locator('.admin-inventory-number')).toHaveText('1');
	const historicalInvalid = linksInventory
		.getByRole('listitem')
		.filter({ has: page.getByRole('link', { name: '/a/b', exact: true }) });
	await expect(historicalInvalid.locator('.admin-inventory-number')).toHaveText('0');
	await expect(domainDetails.getByRole('heading', { name: 'Details', exact: true })).toBeVisible();
	const domainReportPath = '/admin/analytics?domain=go.example.org';
	await expect(domainDetails.locator('dt')).toHaveText(['Domain', 'Root', 'Fallback', 'Analytics']);
	await expect(domainDetails.locator('dd')).toHaveText([
		'go.example.org',
		'Uses fallback',
		'404 Not found',
		domainReportPath
	]);
	await expect(rootRow.getByText('Root visits', { exact: true })).toBeVisible();
	await expect(rootRow.locator('.admin-inventory-number')).toHaveText('1');
	await expect(domainDetails.getByRole('link', { name: 'Root', exact: true })).toHaveCount(0);
	await expect(domainDetails.getByRole('link', { name: 'Fallback', exact: true })).toHaveCount(0);
	const domainAnalyticsLink = domainDetails.getByRole('link', {
		name: domainReportPath,
		exact: true
	});
	await expect(domainAnalyticsLink).toHaveAttribute('href', domainReportPath);
	await expect(
		linksInventory.getByText('https://example.org/first-domain', { exact: true })
	).toBeVisible();
	await expect(
		linksInventory.getByRole('link', { name: 'https://example.org/first-domain', exact: true })
	).toHaveCount(0);
	await expect(rootLink).toHaveAttribute('href', '/admin/domains/go.example.org/links');

	const redirectCard = page.getByRole('region', { name: 'Redirect', exact: true });
	const settingsCard = page.getByRole('region', { name: 'Settings', exact: true });
	const docsPath = '/admin/domains/go.example.org/links/docs';
	await page.getByRole('link', { name: '/docs', exact: true }).click();
	await expect(page).toHaveURL(`${appServer.origin}${docsPath}`);
	await expect(page.getByRole('heading', { name: 'Link', exact: true })).toBeVisible();
	const summaryVisitCount = page
		.getByRole('region', { name: 'Summary', exact: true })
		.getByRole('region', { name: 'Total Visits', exact: true })
		.locator('.admin-stat-value');
	const acceptedLanguages = page.getByRole('region', { name: 'Accepted languages', exact: true });
	await expect(context).toHaveCount(0);
	await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
		'Summary',
		'Redirect',
		'Settings'
	]);
	await expect(redirectCard.locator('dt')).toHaveText([
		'Domain',
		'Path',
		'Title',
		'Destination',
		'Rules',
		'Analytics'
	]);
	await expect(redirectCard.getByText(docsTitle, { exact: true })).toBeVisible();
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
		tagPath
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
		'/admin/domains/go.example.org'
	);
	await expect(redirectCard.locator('dd').nth(1)).toHaveText('/docs');
	await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText([
		'Total Visits',
		'Status'
	]);
	await expect(page.getByRole('region', { name: 'Status', exact: true })).toContainText('Active');
	await expect(page).toHaveTitle('Link — go.example.org/docs — GoTo');
	await expect(summaryVisitCount).toHaveText('1');
	await expect(timeframe).toHaveCount(0);
	await expect(trend).toHaveCount(0);
	await expect(acceptedLanguages).toHaveCount(0);
	await expect(overviewLink).toHaveAttribute('href', '/admin');
	await expect(
		page.getByRole('region', { name: 'Links on go.example.org', exact: true })
	).toHaveCount(0);

	await settingsCard.getByRole('link', { name: sharedTag, exact: true }).click();
	await expect(page).toHaveURL(`${appServer.origin}${tagPath}`);
	await expect(page.getByRole('heading', { level: 1, name: 'Tag', exact: true })).toBeVisible();
	await expect(page).toHaveTitle(`Tag: ${sharedTag} — GoTo`);
	await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
		'Summary',
		'Details',
		'Links'
	]);
	const tagDetails = page.getByRole('region', { name: 'Details', exact: true });
	const tagQuery = new URLSearchParams({ tag: sharedTag });
	const tagReportPath = `/admin/analytics?${tagQuery}`;
	await expect(tagDetails.locator('dt')).toHaveText(['Tag Name', 'Analytics']);
	await expect(tagDetails.locator('dd')).toHaveText([sharedTag, tagReportPath]);
	const tagAnalyticsLink = tagDetails.getByRole('link', { name: tagReportPath, exact: true });
	await tagAnalyticsLink.click();
	await expect(page).toHaveURL(`${appServer.origin}${tagReportPath}`);
	const tagScopePicker = page.getByRole('combobox', { name: 'Report scope', exact: true });
	await expect(tagScopePicker).toHaveAttribute('placeholder', `Tag: ${sharedTag}`);
	await page.goBack();
	const tagSummary = page.getByRole('region', { name: 'Summary', exact: true });
	await expect(tagSummary.locator('.admin-stat-label')).toHaveText([
		'Domains',
		'Links',
		'Total Visits'
	]);
	await expect(tagSummary.locator('.admin-stat-value')).toHaveText(['2', '2', '2']);
	await expect(timeframe).toHaveCount(0);
	await expect(trend).toHaveCount(0);
	const taggedLinks = page.getByRole('region', { name: `Links tagged ${sharedTag}`, exact: true });
	await expect(taggedLinks.getByRole('link')).toHaveCount(2);
	await expect(taggedLinks.locator('.admin-inventory-heading > span')).toHaveText([
		'Domain',
		'Path',
		'State',
		'Total Visits'
	]);
	await expect(taggedLinks.locator('.admin-inventory-number')).toHaveText(['1', '1']);
	const taggedDocs = taggedLinks.getByRole('link', { name: 'go.example.org/docs', exact: true });
	await expect(taggedDocs.locator('.admin-inventory-primary')).toHaveText('go.example.org');
	await expect(taggedDocs.locator('.admin-inventory-secondary')).toHaveText('/docs');
	await expect(taggedDocs).toHaveAttribute('href', docsPath);
	await expect(
		taggedLinks.getByRole('link', { name: 'tiny.example.org/docs', exact: true })
	).toBeVisible();
	await taggedDocs.click();
	await expect(page).toHaveURL(`${appServer.origin}${docsPath}`);
	await expect(summaryVisitCount).toHaveText('1');

	await overviewLink.click();
	await domainLink.click();
	await page.getByRole('link', { name: '/a%2Fb', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Link', exact: true })).toBeVisible();
	await expect(page).toHaveTitle('Link — go.example.org/a%2Fb — GoTo');
	await expect(redirectCard.getByText('Title', { exact: true })).toHaveCount(0);
	await expect(page).toHaveURL(`${appServer.origin}/admin/domains/go.example.org/links/a%252Fb`);
	await expect(summaryVisitCount).toHaveText('1');
	const literalPercentReportPath = `${domainReportPath}&path=%2Fa%252Fb`;
	const literalPercentReport = redirectCard.getByRole('link', {
		name: literalPercentReportPath,
		exact: true
	});
	await expect(literalPercentReport).toHaveAttribute('href', literalPercentReportPath);
	const linkSummary = page.getByRole('region', { name: 'Summary', exact: true });
	await expect(linkSummary.getByRole('region', { name: 'Status', exact: true })).toContainText(
		'Limit Exceeded'
	);
	await expect(
		linkSummary
			.getByRole('region', { name: 'Max visits', exact: true })
			.getByText('1', { exact: true })
	).toBeVisible();
	await page.goBack();
	await page.getByRole('link', { name: '/a/b', exact: true }).click();
	await expect(page).toHaveURL(`${appServer.origin}/admin/domains/go.example.org/links/a/b`);
	await expect(page.getByRole('heading', { name: 'Link', exact: true })).toBeVisible();
	await expect(page).toHaveTitle('Link — go.example.org/a/b — GoTo');
	await expect(summaryVisitCount).toHaveText('0');
	const nestedReportPath = `${domainReportPath}&path=%2Fa%2Fb`;
	const nestedReport = redirectCard.getByRole('link', { name: nestedReportPath, exact: true });
	await expect(nestedReport).toHaveAttribute('href', nestedReportPath);

	await page.goBack();
	await rootLink.click();
	await expect(page).toHaveURL(`${appServer.origin}/admin/domains/go.example.org/links`);
	await expect(page.getByRole('heading', { name: 'Root', exact: true })).toBeVisible();
	await expect(page).toHaveTitle('Root — go.example.org — GoTo');
	await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
		'Summary',
		'Root details',
		'Fallback'
	]);
	await expect(timeframe).toHaveCount(0);
	await expect(trend).toHaveCount(0);
	await expect(rootVisits.locator('.admin-stat-value')).toHaveText('1');
	await expect(page.getByRole('region', { name: 'Status', exact: true })).toHaveCount(0);
	const rootDetails = page.getByRole('region', { name: 'Root details', exact: true });
	await expect(rootDetails.locator('dt')).toHaveText([
		'Domain',
		'Address',
		'Destination',
		'Analytics'
	]);
	const rootReportPath = `${domainReportPath}&path=%2F`;
	await expect(rootDetails.locator('dd')).toHaveText([
		'go.example.org',
		'go.example.org/',
		'Uses fallback',
		rootReportPath
	]);
	await expect(page.getByRole('region', { name: 'Fallback', exact: true })).toContainText(
		'404 Not found'
	);
	const rootAnalyticsLink = rootDetails.getByRole('link', { name: rootReportPath, exact: true });
	await expect(rootAnalyticsLink).toHaveAttribute('href', rootReportPath);
	await rootDetails.getByRole('link', { name: 'go.example.org', exact: true }).click();
	await expect(totalVisits.getByText('2', { exact: true })).toBeVisible();

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

	await page
		.getByRole('navigation', { name: 'Administration', exact: true })
		.getByRole('link', { name: 'Analytics', exact: true })
		.click();
	await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
	const analyticsVisits = page.getByRole('region', { name: 'Visits', exact: true });
	const analyticsChart = page.getByRole('region', { name: 'Visits over time', exact: true });
	await expect(analyticsVisits).toContainText('2');
	await expect(analyticsChart.getByRole('row', { name: 'Total 2', exact: true })).toBeVisible();
	await expect(invalidClicks.locator('.admin-stat-value')).toHaveText('1');
	await expect(rootVisits.locator('.admin-stat-value')).toHaveText('1');
	const reportFilters = page.getByRole('group', { name: 'Report filters', exact: true });
	const scopeInput = reportFilters.getByRole('combobox', { name: 'Report scope', exact: true });
	const scopeOptions = page.getByRole('listbox', { name: 'Report scopes', exact: true });
	async function chooseReportScope(option: string) {
		await scopeInput.click();
		await scopeOptions.getByRole('option', { name: option, exact: true }).click();
	}
	await expect(scopeInput).toHaveAttribute('placeholder', 'All traffic');
	const analyticsUrl = `${appServer.origin}/admin/analytics`;
	const goReportUrl = `${analyticsUrl}?period=7d&domain=go.example.org`;
	await timeframe.getByRole('button', { name: '7 days', exact: true }).click();
	await expect(page).toHaveURL(`${analyticsUrl}?period=7d`);
	await chooseReportScope('go.example.org');
	await expect(page).toHaveURL(goReportUrl);
	await expect(analyticsChart.getByRole('row', { name: 'Total 0', exact: true })).toBeVisible();

	const isHeldRedirectRequest = (url: URL) =>
		url.pathname === '/admin/analytics/__data.json' &&
		url.searchParams.get('domain') === 'go.example.org' &&
		url.searchParams.get('path') === '/a/b';
	const releaseRedirectReport = Promise.withResolvers<void>();
	await page.route(
		isHeldRedirectRequest,
		async (route) => {
			await releaseRedirectReport.promise;
			await route.continue();
		},
		{ times: 1 }
	);
	try {
		const [heldRequest] = await Promise.all([
			page.waitForRequest((request) => isHeldRedirectRequest(new URL(request.url()))),
			chooseReportScope('go.example.org/a/b')
		]);
		await expect(reportFilters).toHaveAttribute('aria-busy', 'true');
		await expect(scopeInput).toHaveAttribute('placeholder', 'Domain: go.example.org');
		await timeframe.getByRole('button', { name: '30 days', exact: true }).click();
		await expect(page).toHaveURL(`${analyticsUrl}?domain=go.example.org`);

		releaseRedirectReport.resolve();
		const lateResponse = await heldRequest.response();
		expect(lateResponse?.ok()).toBe(true);
		await expect(reportFilters).toHaveAttribute('aria-busy', 'false');
		await expect(page).toHaveURL(`${analyticsUrl}?domain=go.example.org`);
		await expect(scopeInput).toHaveAttribute('placeholder', 'Domain: go.example.org');
		await expect(analyticsVisits).toContainText('1');
		await expect(analyticsChart.getByRole('row', { name: 'Total 1', exact: true })).toBeVisible();
	} finally {
		releaseRedirectReport.resolve();
	}
	await page.goBack();
	await page.goBack();
	await expect(page).toHaveURL(`${analyticsUrl}?period=7d`);
	await expect(scopeInput).toHaveAttribute('placeholder', 'All traffic');
	await expect(analyticsChart.getByRole('row', { name: 'Total 1', exact: true })).toBeVisible();

	const searchRequests: string[] = [];
	function recordSearchRequest(request: Request) {
		const url = new URL(request.url());
		if (url.origin === appServer.origin && url.pathname.startsWith('/admin/analytics')) {
			searchRequests.push(url.href);
		}
	}
	page.on('request', recordSearchRequest);
	try {
		await scopeInput.fill('/DOCS');
		await expect(scopeOptions.getByRole('option')).toHaveText([
			'go.example.org/docs',
			'tiny.example.org/docs'
		]);
		await expect(page).toHaveURL(`${analyticsUrl}?period=7d`);
		await expect(analyticsChart.getByRole('row', { name: 'Total 1', exact: true })).toBeVisible();
		expect(searchRequests).toEqual([]);
	} finally {
		page.off('request', recordSearchRequest);
	}
	await scopeOptions.getByRole('option', { name: 'go.example.org/docs', exact: true }).click();
	await expect(page).toHaveURL(`${goReportUrl}&path=%2Fdocs`);
	await expect(analyticsChart.getByRole('row', { name: 'Total 0', exact: true })).toBeVisible();
	await chooseReportScope('go.example.org/ (Root)');
	await expect(page).toHaveURL(`${goReportUrl}&path=%2F`);
	const rootChart = page.getByRole('region', { name: 'Root visits over time', exact: true });
	await expect(rootChart.getByRole('row', { name: 'Total 1', exact: true })).toBeVisible();
	await expect(rootVisits.locator('.admin-stat-value')).toHaveText('1');
	await expect(invalidClicks).toHaveCount(0);
	await page.goBack();
	await expect(scopeInput).toHaveAttribute('placeholder', 'go.example.org/docs');
	await expect(analyticsChart.getByRole('row', { name: 'Total 0', exact: true })).toBeVisible();

	await chooseReportScope('tiny.example.org/docs');
	const tinyReportUrl = `${analyticsUrl}?period=7d&domain=tiny.example.org`;
	await expect(page).toHaveURL(`${tinyReportUrl}&path=%2Fdocs`);
	await expect(analyticsChart.getByRole('row', { name: 'Total 1', exact: true })).toBeVisible();

	await scopeInput.click();
	await expect(scopeOptions).toBeVisible();
	const popupId = await scopeOptions.getAttribute('id');
	expect(popupId).toBeTruthy();
	await expect(scopeInput).toHaveAttribute('aria-controls', popupId ?? '');
	await scopeInput.press('Home');
	const allTraffic = scopeOptions.getByRole('option', { name: 'All traffic', exact: true });
	await expect(scopeInput).toHaveAttribute(
		'aria-activedescendant',
		(await allTraffic.getAttribute('id')) ?? ''
	);
	await scopeInput.fill('work/100%');
	await expect(scopeOptions.getByRole('option')).toHaveText([sharedTag]);
	await scopeInput.press('ArrowDown');
	await scopeInput.press('Enter');
	const tagReportUrl = `${analyticsUrl}?period=7d&${new URLSearchParams({ tag: sharedTag })}`;
	await expect(page).toHaveURL(tagReportUrl);
	await expect(scopeInput).toHaveAttribute('placeholder', `Tag: ${sharedTag}`);
	await expect(analyticsChart.getByRole('row', { name: 'Total 1', exact: true })).toBeVisible();
	await timeframe.getByRole('button', { name: '30 days', exact: true }).click();
	await expect(page).toHaveURL(`${analyticsUrl}?${new URLSearchParams({ tag: sharedTag })}`);
	await expect(analyticsChart.getByRole('row', { name: 'Total 2', exact: true })).toBeVisible();
	await expect(acceptedLanguages.getByRole('row', { name: 'fr 1 50%', exact: true })).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(tagReportUrl);
	await page.reload();
	await expect(scopeInput).toHaveAttribute('placeholder', `Tag: ${sharedTag}`);
	await expect(analyticsChart.getByRole('row', { name: 'Total 1', exact: true })).toBeVisible();

	await scopeInput.click();
	await expect(scopeOptions).toBeVisible();
	await scopeInput.fill('long-picker-tag-');
	const longTag = `long-picker-tag-${'w'.repeat(1400)}`;
	await expect(scopeOptions.getByRole('option')).toHaveText([longTag]);
	await scopeInput.press('ArrowDown');
	await scopeInput.press('Enter');
	await expect(page).toHaveURL(
		`${analyticsUrl}?period=7d&${new URLSearchParams({ tag: longTag })}`
	);
	await expect(analyticsChart.getByRole('row', { name: 'Total 0', exact: true })).toBeVisible();

	await page.goto(`${analyticsUrl}?period=7d&tag=Removed`);
	await expect(page.getByRole('status')).toContainText(
		'This report scope is no longer configured.'
	);
	await expect(analyticsChart).toHaveCount(0);
	await chooseReportScope('All traffic');
	await expect(page).toHaveURL(`${analyticsUrl}?period=7d`);
	await expect(analyticsChart.getByRole('row', { name: 'Total 1', exact: true })).toBeVisible();

	await chooseReportScope('go.example.org/docs');
	await expect(page).toHaveURL(`${goReportUrl}&path=%2Fdocs`);
	await page.setViewportSize({ width: 390, height: 844 });
	const graph = analyticsChart.getByRole('img');
	const browsers = page.getByRole('region', { name: 'Browsers', exact: true });
	const operatingSystems = page.getByRole('region', { name: 'Operating systems', exact: true });
	await expect(graph).toHaveAccessibleName(/^Visits by day\. Total: 0\./);
	await expect(browsers).toContainText('No visits in this period.');
	await expect(operatingSystems).toContainText('No visits in this period.');
	await expect(acceptedLanguages).toContainText('No visits in this period.');

	await page.getByRole('button', { name: 'Timeframe: 7 days', exact: true }).click();
	await page
		.getByRole('listbox', { name: 'Timeframe', exact: true })
		.getByRole('option', { name: '90 days', exact: true })
		.click();
	const fullDomainUrl = `${analyticsUrl}?period=all&domain=go.example.org`;
	await expect(page).toHaveURL(`${fullDomainUrl}&path=%2Fdocs`);
	await expect(graph).toHaveAttribute('aria-busy', 'false');
	await expect(graph).toHaveAccessibleName(/^Visits by week\. Total: 1\./);
	await expect(browsers.getByRole('row', { name: 'Firefox 1 100%', exact: true })).toBeVisible();
	await expect(
		operatingSystems.getByRole('row', { name: 'Linux 1 100%', exact: true })
	).toBeVisible();
	await expect(
		acceptedLanguages.getByRole('row', { name: 'fr 1 100%', exact: true })
	).toBeVisible();
	await page.setViewportSize({ width: 1280, height: 720 });
	await chooseReportScope('go.example.org/a%2Fb');
	const literalPathUrl = `${fullDomainUrl}&path=%2Fa%252Fb`;
	await expect(page).toHaveURL(literalPathUrl);
	await expect(analyticsChart.getByRole('row', { name: 'Total 1', exact: true })).toBeVisible();
	await chooseReportScope('go.example.org/a/b');
	await expect(page).toHaveURL(`${fullDomainUrl}&path=%2Fa%2Fb`);
	await expect(analyticsChart.getByRole('row', { name: 'Total 0', exact: true })).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(literalPathUrl);
	await expect(scopeInput).toHaveAttribute('placeholder', 'go.example.org/a%2Fb');
	await expect(analyticsChart.getByRole('row', { name: 'Total 1', exact: true })).toBeVisible();

	const html = await page.content();
	await expect(html).not.toContain('e2e-only-password');
	await page.setViewportSize({ width: 390, height: 844 });
	await page
		.getByRole('navigation', { name: 'Administration', exact: true })
		.getByRole('button', { name: 'Sign out', exact: true })
		.click();
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
		const adminNav = page.getByRole('navigation', { name: 'Administration', exact: true });
		await expect(adminNav.getByRole('link', { name: 'Analytics', exact: true })).toHaveCount(0);
		await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText([
			'Domains',
			'Links',
			'Total Visits',
			'Invalid clicks',
			'Root visits'
		]);
		await expect(
			page
				.getByRole('region', { name: 'Total Visits', exact: true })
				.getByText('0', { exact: true })
		).toBeVisible();
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
		).toHaveText(['Host', 'Links', 'Total Visits']);
		await page.getByRole('link', { name: 'go.example.org', exact: true }).click();
		await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText([
			'Links',
			'Total Visits',
			'Invalid clicks',
			'Root visits'
		]);
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
		).toHaveText(['Path', 'Destination', 'State', 'Visits']);
		const details = page.getByRole('region', { name: 'Details', exact: true });
		const reportLinks = 'a[href^="/admin/analytics"]';
		await expect(details.locator('dt')).toHaveText(['Domain', 'Root', 'Fallback']);
		await expect(details.locator(reportLinks)).toHaveCount(0);
		const rootLink = page
			.getByRole('region', { name: 'Links on go.example.org', exact: true })
			.getByRole('link', { name: '(root)', exact: true });
		await rootLink.click();
		const rootDetails = page.getByRole('region', { name: 'Root details', exact: true });
		await expect(rootDetails).toBeVisible();
		await expect(rootDetails.locator(reportLinks)).toHaveCount(0);
		await page.goBack();
		await page.getByRole('link', { name: '/docs', exact: true }).click();
		const redirectCard = page.getByRole('region', { name: 'Redirect', exact: true });
		await expect(redirectCard).toBeVisible();
		await expect(redirectCard.locator(reportLinks)).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Browsers', exact: true })).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Operating systems', exact: true })).toHaveCount(
			0
		);
		await expect(page.locator('.admin-cards .admin-stat-label')).toHaveText([
			'Total Visits',
			'Status'
		]);
		await expect(
			page
				.getByRole('region', { name: 'Total Visits', exact: true })
				.getByText('0', { exact: true })
		).toBeVisible();
		await expect(page.getByRole('region', { name: 'Status', exact: true })).toContainText('Active');
		await expect(page.getByRole('group', { name: 'Timeframe', exact: true })).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Accepted languages', exact: true })).toHaveCount(
			0
		);
		await expect(page.getByRole('region', { name: 'Visits over time', exact: true })).toHaveCount(
			0
		);
		await page.goto('/admin/analytics?period=7d');
		await expect(page).toHaveURL(`${appServer.origin}/admin/health`);
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
		await expect(page.getByRole('heading', { level: 1, name: 'Tag', exact: true })).toBeVisible();
		await expect(details.locator('dt')).toHaveText('Tag Name');
		await expect(details.locator('dd')).toHaveText(sharedTag);
		await expect(details.locator(reportLinks)).toHaveCount(0);
		const tagSummary = page.getByRole('region', { name: 'Summary', exact: true });
		await expect(tagSummary.locator('.admin-stat-value')).toHaveText(['2', '2', '0']);
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
			'State',
			'Total Visits'
		]);
	});
});
