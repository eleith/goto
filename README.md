# GoTo

A small, self-hosted URL shortener. Give a long address a short name and get on with it.

One YAML file can run links for several domains. The admin shows what’s configured and how often links are used. To change a link, edit the file.

## Get started

Let’s assume you have Docker Compose. From a checkout:

```sh
mkdir -p apps/web/config apps/web/data
```

Save this as `apps/web/config/goto.yaml`. Pick a password before starting.

```yaml
url:
  app: http://localhost:5173

auth:
  credentials:
    username: admin
    password: 'pick-a-local-password'

domains:
  localhost:5173:
    links:
      /hello:
        url: https://example.org
```

If your user and group IDs aren’t `1000:1000`, set `LOCAL_UID` and `LOCAL_GID` before running Compose.

```sh
docker compose -f apps/web/docker-compose.dev.yml up --build --wait
```

When the command finishes, open <http://localhost:5173/hello>. It should send you on your way. Sign in at <http://localhost:5173/admin> to see the link. The worker prepares Analytics in the background, so don’t stare at the chart waiting for that first click.

## Why this way?

**Why YAML?** You can review a diff and undo a bad edit. Keep the link rules in Git if you like; keep the passwords out of it. The admin is read-only so there’s no second place to change a link.

**Why a worker?** Sending someone to a link shouldn’t wait for a report. The web app redirects; the worker prepares reports from SQLite in the background.

**What gets kept?** Analytics keeps 90 days of detail by default. Set `analytics.retention_months: 0` to turn off detailed Analytics without losing lifetime totals. Stop both services before reducing retention or switching between zero and a positive value, then start them again.

## Configuration and deployment

The [example YAML](examples/goto.yaml) shows multiple domains, SSO, tags and conditional redirects. The [schema](packages/config/src/config.schema.json) has the full list of options. Most link edits take effect without a restart.

Use the [production Compose file](apps/web/docker-compose.yml) behind an HTTPS reverse proxy. Set `url.app` to the public admin origin and put your short-link hosts under `domains`. They can share a host or use separate ones. Keep the backend private; have the proxy preserve `Host` and set `X-Forwarded-Proto` and `X-Real-IP`. Put `PROTOCOL_HEADER=X-Forwarded-Proto` in `apps/web/.env`.

Keep `apps/web/data` writable by both containers and backed up. Use a stable, random `auth.secret` of at least 32 characters, passed in through the environment as in the example.

## Development

The [development Compose file](apps/web/docker-compose.dev.yml) reloads the app as you edit. For local tooling, [mise](mise.toml) pins Node and pnpm. `pnpm verify` runs the checks, including Chromium browser tests.
