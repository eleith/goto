# Testing

From the repository root, use the Node and pnpm versions pinned in [mise.toml](../mise.toml):

```sh
pnpm install --frozen-lockfile
pnpm --filter @goto/web exec playwright install chromium
pnpm verify
```

`pnpm verify` checks editor schema drift, builds the apps, checks types and lint, runs workspace tests with coverage, exercises the production web build in Chromium, and runs the worker smoke test. Playwright needs Chromium and its system dependencies.

For a smaller run, use `pnpm --filter @goto/config test`. For web tests on a fresh checkout, run `pnpm build:packages` first, then `pnpm --filter @goto/web test`. After changing the configuration schema, run `pnpm schema:generate` and include the resulting editor schema in the change.

Prefer focused tests of GoTo’s behavior. Use browser tests for boundaries that need the production server or a real browser, such as sign-in and host routing. Use the [development setup](development.md) to check hot reload in a working app; the browser suite tests the production build instead.
