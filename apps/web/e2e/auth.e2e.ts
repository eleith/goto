import { expect, test } from './support/test.ts';

test('shared credentials protect the read-only inventory and sign-out removes access', async ({
	page,
	appServer
}) => {
	await page.goto(`${appServer.origin}/admin`);
	await expect(page).toHaveURL(/\/signin\?/);
	await page.getByLabel('Username', { exact: true }).fill('example');
	await page.getByLabel('Password', { exact: true }).fill('incorrect');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Invalid username or password');

	await page.getByLabel('Password', { exact: true }).fill('e2e-only-password');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Configured links', exact: true })).toBeVisible();
	await expect(
		page
			.getByRole('region', { name: 'Links on go.example.org', exact: true })
			.getByRole('link', { name: 'https://example.org/first-domain', exact: true })
	).toBeVisible();

	await page.getByRole('button', { name: 'Sign out', exact: true }).click();
	await expect(page).toHaveURL(/\/signin\?/);
	await page.goto(`${appServer.origin}/admin`);
	await expect(page).toHaveURL(/\/signin\?/);
	await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
});
