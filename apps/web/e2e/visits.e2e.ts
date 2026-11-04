import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from './support/test.ts';

function visitCount(path: string, logicalPath: string): number {
	if (!existsSync(path)) return 0;
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		const row = db
			.prepare('SELECT count(*) AS count FROM visits WHERE domain = ? AND path = ?')
			.get('go.example.org', logicalPath);
		return Number(row?.count ?? 0);
	} catch {
		return 0;
	} finally {
		db.close();
	}
}

test('the compiled writer isolates lock waits and drains accepted visits before shutdown', async ({
	request,
	appServer
}) => {
	const databasePath = resolve(dirname(appServer.configurationPath), '../data/goto.sqlite');
	const options = {
		headers: {
			host: 'go.example.org',
			'user-agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:158.0) Gecko/20100101 Firefox/158.0'
		},
		maxRedirects: 0,
		timeout: 2000
	};
	await expect
		.poll(
			async () => {
				await request.get('/healthz', options);
				return visitCount(databasePath, '/healthz');
			},
			{ timeout: 15_000 }
		)
		.toBeGreaterThan(0);

	const competingWriter = new DatabaseSync(databasePath);
	try {
		competingWriter.exec('PRAGMA busy_timeout = 1000');
		competingWriter.exec('BEGIN IMMEDIATE');
		for (let index = 0; index < 3; index++) {
			const response = await request.get('/docs', options);
			expect(response.status()).toBe(302);
			expect(response.headers().location).toBe('https://example.org/first-domain');
		}
		expect(visitCount(databasePath, '/docs')).toBe(0);
	} finally {
		competingWriter.exec('ROLLBACK');
		competingWriter.close();
	}
	expect(await appServer.stop()).toEqual({ code: 0, signal: null });
	expect(visitCount(databasePath, '/docs')).toBe(3);
	const db = new DatabaseSync(databasePath, { readOnly: true });
	try {
		expect(
			db.prepare('SELECT DISTINCT browser, os FROM visits WHERE path = ?').all('/docs')
		).toEqual([{ browser: 'Firefox', os: 'Linux' }]);
	} finally {
		db.close();
	}
	expect(appServer.logs()).not.toContain('Visit tracking unavailable');
});
