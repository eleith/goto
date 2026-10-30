import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	testMatch: '**/*.e2e.ts',
	globalSetup: './e2e/setup.ts',
	fullyParallel: true,
	workers: 4,
	forbidOnly: Boolean(process.env.CI),
	failOnFlakyTests: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	use: {
		timezoneId: 'UTC',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
