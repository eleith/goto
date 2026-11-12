import { expect, test } from 'vitest';
import { classifyUserAgent } from './classify-user-agent.js';

test('recognizes Edge before the generic Chrome and Safari tokens', () => {
	for (const token of ['Edg', 'EdgA', 'EdgiOS', 'Edge']) {
		const result = classifyUserAgent(`Mozilla/5.0 Chrome/125.0 Safari/537.36 ${token}/125.0`);
		expect(result.browser).toBe('Edge');
	}
});

test.each([
	{
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0 Safari/537.36',
		browser: 'Chrome',
		os: 'Windows'
	},
	{
		ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/125.0 Safari/537.36 OPR/110.0',
		browser: 'Opera',
		os: 'Android'
	},
	{
		ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) CriOS/125.0 Mobile Safari/604.1',
		browser: 'Chrome',
		os: 'iOS'
	},
	{
		ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.5 Safari/605.1',
		browser: 'Safari',
		os: 'macOS'
	},
	{
		ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:158.0) Gecko/20100101 Firefox/158.0',
		browser: 'Firefox',
		os: 'Linux'
	},
	{
		ua: 'Mozilla/5.0 (X11; CrOS x86_64 15886.44.0) Chrome/125.0 Safari/537.36',
		browser: 'Chrome',
		os: 'ChromeOS'
	},
	{ ua: null, browser: 'Other', os: 'Other' },
	{ ua: 'curl/8.12.0', browser: 'Other', os: 'Other' }
])('classifies $browser on $os without parsing versions', ({ ua, browser, os }) => {
	expect(classifyUserAgent(ua)).toEqual({ browser, os });
});
