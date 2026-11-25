import type { Page, Request } from '@playwright/test';
import { expect, test } from './support/test.ts';

test.use({ withWorker: true });

const domain = 'go.example.org';
const domainPath = `/admin/domains/${domain}`;
const docsPath = `${domainPath}/links/docs`;
const analyticsPath = '/admin/analytics';
const healthPath = '/admin/health';
const sharedTag = 'Work/100%é';
const demoPassword = 'e2e-only-password';

test('sign-in protects admin and lets operators inspect links, worker health and Analytics', async ({
	page,
	request,
	appServer
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	const adminNav = page.getByRole('navigation', { name: 'Administration', exact: true });

	await test.step('Reject anonymous requests and invalid credentials', async () => {
		const root = await request.get('/', { maxRedirects: 0 });
		expect(root.status()).toBe(404);
		expect(root.headers().location).toBeUndefined();

		const redirect = await request.get(analyticsPath, {
			headers: { accept: 'text/html' },
			maxRedirects: 0
		});
		expect(redirect.status()).toBe(303);
		expect(redirect.headers().location).toBe('/signin?callbackUrl=%2Fadmin%2Fanalytics');
		expect(redirect.headers()['cache-control']).toBe('private, no-store');

		const signInPage = await page.goto('/admin');
		await expect(page).toHaveURL(/\/signin\?/);
		expect(signInPage?.headers()['cache-control']).toBe('private, no-store');
		const failedSignIn = page.waitForResponse(`${appServer.origin}/auth/sign-in/credentials`);
		await submitCredentials(page, 'incorrect');
		expect((await failedSignIn).headers()['cache-control']).toBe('private, no-store');
		await expect(page.getByRole('alert')).toContainText('Invalid username or password');
	});

	await test.step('Open the inventory and its scoped reports after signing in', async () => {
		await submitCredentials(page, demoPassword);
		await expect(page).toHaveURL('/admin');
		const overview = await page.goto('/admin?period=7d');
		expect(overview?.headers()['cache-control']).toBe('private, no-store');
		const lifetimeVisits = page.getByRole('region', { name: 'Total Visits', exact: true });
		await expect(lifetimeVisits.getByText('4', { exact: true })).toBeVisible();

		await page.getByRole('link', { name: domain, exact: true }).click();
		await expect(page).toHaveURL(domainPath);
		const rootLink = page.getByRole('link', { name: '(root)', exact: true });
		const rootRow = page.getByRole('listitem').filter({ has: rootLink });
		await expect(rootRow.getByText('Root visits', { exact: true })).toHaveCount(0);
		await expect(rootRow.locator('.admin-inventory-number')).toHaveText('1');
		await rootLink.click();
		await expect(page).toHaveURL(`${domainPath}/links`);
		const rootReport = `${analyticsPath}?domain=${domain}&path=%2F`;
		await expect(page.getByRole('link', { name: rootReport, exact: true })).toHaveAttribute(
			'href',
			rootReport
		);

		await page.goBack();
		await page.getByRole('link', { name: '/docs', exact: true }).click();
		await expect(page).toHaveURL(docsPath);
		const tagLink = page.getByRole('link', { name: sharedTag, exact: true });
		await tagLink.click();
		await expect(page).toHaveURL(`/admin/tags/${encodeURIComponent(sharedTag)}`);
		const tagReport = `${analyticsPath}?${new URLSearchParams({ tag: sharedTag })}`;
		await page.getByRole('link', { name: tagReport, exact: true }).click();
		await expect(page).toHaveURL(tagReport);
		await expect(page.getByRole('combobox', { name: 'Report scope' })).toHaveAttribute(
			'placeholder',
			`Tag: ${sharedTag}`
		);
		const languages = page.getByRole('region', { name: 'Accepted languages', exact: true });
		await expect(languages.getByRole('row', { name: 'fr 1 50%', exact: true })).toBeVisible();
	});

	await test.step('Check the real worker from Health', async () => {
		await adminNav.getByRole('link', { name: 'Health', exact: true }).click();
		const worker = page.getByRole('region', { name: 'Worker', exact: true });
		await expect(worker.getByRole('status')).toHaveText('Not checked');
		await worker.getByRole('button', { name: 'Test worker', exact: true }).click();
		await expect(worker.getByRole('alert')).toContainText('Worker is reachable.');
	});

	await adminNav.getByRole('link', { name: 'Analytics', exact: true }).click();
	const chart = page.getByRole('region', { name: 'Visits over time', exact: true });
	const timeframe = page.getByRole('group', { name: 'Timeframe', exact: true });
	const reportFilters = page.getByRole('group', { name: 'Report filters', exact: true });
	const scopeInput = reportFilters.getByRole('combobox', { name: 'Report scope', exact: true });
	const scopeOptions = page.getByRole('listbox', { name: 'Report scopes', exact: true });
	const weekPath = `${analyticsPath}?period=7d`;
	const domainWeekPath = `${weekPath}&domain=${domain}`;

	async function chooseReportScope(label: string) {
		await scopeInput.click();
		await scopeOptions.getByRole('option', { name: label, exact: true }).click();
	}

	async function expectChartTotal(total: number) {
		await expect(chart.getByRole('row', { name: `Total ${total}`, exact: true })).toBeVisible();
	}

	await test.step('A late scope response cannot replace a newer timeframe', async () => {
		await timeframe.getByRole('button', { name: '7 days', exact: true }).click();
		await chooseReportScope(domain);
		await expect(page).toHaveURL(domainWeekPath);

		function isNestedLinkReport(url: URL) {
			return (
				url.pathname === `${analyticsPath}/__data.json` &&
				url.searchParams.get('domain') === domain &&
				url.searchParams.get('path') === '/a/b'
			);
		}
		const releaseReport = Promise.withResolvers<void>();
		await page.route(
			isNestedLinkReport,
			async (route) => {
				await releaseReport.promise;
				await route.continue();
			},
			{ times: 1 }
		);
		try {
			const [heldRequest] = await Promise.all([
				page.waitForRequest((request) => isNestedLinkReport(new URL(request.url()))),
				chooseReportScope(`${domain}/a/b`)
			]);
			await expect(reportFilters).toHaveAttribute('aria-busy', 'true');
			await expect(scopeInput).toHaveAttribute('placeholder', `Domain: ${domain}`);
			await timeframe.getByRole('button', { name: '30 days', exact: true }).click();
			const selectedReport = `${analyticsPath}?domain=${domain}`;
			await expect(page).toHaveURL(selectedReport);

			releaseReport.resolve();
			expect((await heldRequest.response())?.ok()).toBe(true);
			await expect(reportFilters).toHaveAttribute('aria-busy', 'false');
			await expect(page).toHaveURL(selectedReport);
			await expect(scopeInput).toHaveAttribute('placeholder', `Domain: ${domain}`);
			await expectChartTotal(1);
		} finally {
			releaseReport.resolve();
		}
	});

	await test.step('Go back to the unfiltered week', async () => {
		await page.goBack();
		await page.goBack();
		await expect(page).toHaveURL(weekPath);
		await expect(scopeInput).toHaveAttribute('placeholder', 'All traffic');
	});

	await test.step('Search without a request and select a wrapped option with the keyboard', async () => {
		const searchRequests: string[] = [];
		function recordSearchRequest(request: Request) {
			const url = new URL(request.url());
			if (url.origin === appServer.origin && url.pathname.startsWith(analyticsPath)) {
				searchRequests.push(url.href);
			}
		}
		page.on('request', recordSearchRequest);
		try {
			await scopeInput.fill('/DOCS');
			await expect(scopeOptions.getByRole('option')).toHaveText([
				`${domain}/docs`,
				'tiny.example.org/docs'
			]);
			await expect(page).toHaveURL(weekPath);
			expect(searchRequests).toEqual([]);
		} finally {
			page.off('request', recordSearchRequest);
		}

		const popupId = await scopeOptions.getAttribute('id');
		expect(popupId).toBeTruthy();
		await expect(scopeInput).toHaveAttribute('aria-controls', popupId ?? '');

		const longTagPrefix = 'long-picker-tag-';
		const longTag = `${longTagPrefix}${'w'.repeat(1400)}`;
		await scopeInput.fill(longTagPrefix);
		await expect(scopeOptions.getByRole('option')).toHaveText([longTag]);
		await scopeInput.press('ArrowDown');
		await scopeInput.press('Enter');
		await expect(page).toHaveURL(`${weekPath}&${new URLSearchParams({ tag: longTag })}`);
	});

	await test.step('Change the report window on mobile without losing the link scope', async () => {
		await chooseReportScope(`${domain}/docs`);
		await expect(page).toHaveURL(`${domainWeekPath}&path=%2Fdocs`);
		await page.setViewportSize({ width: 390, height: 844 });
		const graph = chart.getByRole('img');
		await expect(graph).toHaveAccessibleName(/^Visits by day\. Total: 0\./);
		await page.getByRole('button', { name: 'Timeframe: 7 days', exact: true }).click();
		await page
			.getByRole('listbox', { name: 'Timeframe', exact: true })
			.getByRole('option', { name: '90 days', exact: true })
			.click();
		await expect(page).toHaveURL(`${analyticsPath}?period=all&domain=${domain}&path=%2Fdocs`);
		await expect(graph).toHaveAttribute('aria-busy', 'false');
		await expect(graph).toHaveAccessibleName(/^Visits by week\. Total: 1\./);
	});

	await test.step('Keep literal percent paths and nested paths distinct', async () => {
		await page.setViewportSize({ width: 1280, height: 720 });
		const report = `${analyticsPath}?period=all&domain=${domain}`;
		await chooseReportScope(`${domain}/a%2Fb`);
		const literalPath = `${report}&path=%2Fa%252Fb`;
		await expect(page).toHaveURL(literalPath);
		await expectChartTotal(1);
		await chooseReportScope(`${domain}/a/b`);
		await expect(page).toHaveURL(`${report}&path=%2Fa%2Fb`);
		await expectChartTotal(0);
		await page.goBack();
		await expect(page).toHaveURL(literalPath);
		await expect(scopeInput).toHaveAttribute('placeholder', `${domain}/a%2Fb`);
	});

	await test.step('Signing out revokes access to a previously visited page', async () => {
		expect(await page.content()).not.toContain(demoPassword);
		await page.setViewportSize({ width: 390, height: 844 });
		await adminNav.getByRole('button', { name: 'Sign out', exact: true }).click();
		await expect(page).toHaveURL(/\/signin\?/);
		await page.goto(docsPath);
		await expect(page).toHaveURL(/\/signin\?/);
		await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
	});
});

test.describe('analytics disabled', () => {
	test.use({ withWorker: false, retentionMonths: 0 });

	test('inventory stays usable while Analytics navigation is disabled', async ({ page }) => {
		await page.goto('/admin');
		await submitCredentials(page, demoPassword);
		await expect(page).toHaveURL('/admin');
		const adminNav = page.getByRole('navigation', { name: 'Administration', exact: true });
		await expect(adminNav.getByRole('link', { name: 'Analytics', exact: true })).toHaveCount(0);
		await page.getByRole('link', { name: domain, exact: true }).click();
		await expect(page).toHaveURL(domainPath);
		await expect(page.getByRole('link', { name: '/docs', exact: true })).toBeVisible();
		await expect(page.locator('main a[href^="/admin/analytics"]')).toHaveCount(0);

		await page.goto(`${analyticsPath}?period=7d`);
		await expect(page).toHaveURL(healthPath);
	});
});

async function submitCredentials(page: Page, password: string) {
	await page.getByLabel('Username', { exact: true }).fill('example');
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
