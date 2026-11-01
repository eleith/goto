import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, request, test } from '@playwright/test';
import { startDevelopment } from './support/development.js';

type RuntimeProbe = { testId: string; revision: string };

async function replaceSource(path: string, before: string, after: string) {
	const source = await readFile(path, 'utf8');
	expect(source.split(before)).toHaveLength(2);
	await writeFile(path, source.replace(before, after));
}

test('real client HMR and SSR edits share one server-owned application until a core restart', async ({
	browser
}, testInfo) => {
	test.setTimeout(120_000);
	const development = await startDevelopment(testInfo);
	const { origin, directory, events, live } = development;
	let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
	let client: Awaited<ReturnType<typeof request.newContext>> | undefined;
	try {
		context = await browser.newContext({ extraHTTPHeaders: {} });
		client = await request.newContext({ baseURL: origin, extraHTTPHeaders: {}, timeout: 2_000 });
		const page = await context.newPage();
		await page.goto(`${origin}/__hmr`);
		await page.getByRole('button', { name: 'count 0', exact: true }).click();
		await expect(page.getByRole('button', { name: 'count 1', exact: true })).toBeVisible();
		await expect(page.getByText('revision one', { exact: true })).toBeVisible();

		async function readRuntime(): Promise<RuntimeProbe | undefined> {
			try {
				const response = await client!.get('/__hmr/runtime');
				if (!response.ok()) return undefined;
				return (await response.json()) as RuntimeProbe;
			} catch {
				return undefined;
			}
		}

		await expect.poll(readRuntime, { timeout: 20_000 }).toEqual({
			testId: expect.any(String),
			revision: 'leaf one'
		});
		const initial = (await readRuntime())!;
		await expect
			.poll(() => events)
			.toEqual([{ type: 'application-start', testId: initial.testId }]);

		const routeDirectory = join(directory, 'src/routes/(admin)/(public)/__hmr');
		await replaceSource(join(routeDirectory, 'Revision.svelte'), 'revision one', 'revision two');
		await expect(page.getByText('revision two', { exact: true })).toBeVisible({ timeout: 20_000 });
		await expect(page.getByRole('button', { name: 'count 1', exact: true })).toBeVisible();
		expect(await readRuntime()).toEqual(initial);
		await expect
			.poll(() => events)
			.toEqual([{ type: 'application-start', testId: initial.testId }]);

		await replaceSource(join(routeDirectory, 'runtime/+server.ts'), 'leaf one', 'leaf two');
		await expect.poll(readRuntime, { timeout: 20_000 }).toEqual({
			testId: initial.testId,
			revision: 'leaf two'
		});
		await expect
			.poll(() => events)
			.toEqual([{ type: 'application-start', testId: initial.testId }]);

		const applicationPath = join(directory, 'src/lib/server/application.ts');
		await writeFile(
			applicationPath,
			(await readFile(applicationPath, 'utf8')) + '\nexport const hmrCoreRevision = 2;\n'
		);
		await expect
			.poll(
				async () => {
					const current = await readRuntime();
					return current?.testId === initial.testId ? undefined : current;
				},
				{ timeout: 30_000 }
			)
			.toEqual({ testId: expect.any(String), revision: 'leaf two' });
		const replacement = (await readRuntime())!;
		await expect
			.poll(() => events)
			.toEqual([
				{ type: 'application-start', testId: initial.testId },
				{ type: 'application-close', testId: initial.testId },
				{ type: 'application-start', testId: replacement.testId }
			]);
		expect(development.getpeak()).toBe(1);
		expect([...live]).toEqual([replacement.testId]);

		await context.close();
		context = undefined;
		await client.dispose();
		client = undefined;
		await development.stop();
		expect(development.getexit()).toEqual({ code: 0, signal: null });
		expect(events).toEqual([
			{ type: 'application-start', testId: initial.testId },
			{ type: 'application-close', testId: initial.testId },
			{ type: 'application-start', testId: replacement.testId },
			{ type: 'application-close', testId: replacement.testId }
		]);
		expect(live.size).toBe(0);
		expect(development.getpeak()).toBe(1);
	} finally {
		try {
			await context?.close();
			await client?.dispose();
		} finally {
			await development.dispose();
		}
	}
});
