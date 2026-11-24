# Configuration

GoTo reads `config/goto.yaml` unless `CONFIG_PATH` points somewhere else. This page explains the fields without requiring an editor extension. For a complete example, see [examples/goto.yaml](../examples/goto.yaml). The [JSON schema](../packages/config/src/config.schema.json) is also served at `/schema.json` on the admin origin.

## Application settings

| Setting                          | Meaning and default                                                                                                                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                        | Configuration format version. Set it to `1`, or omit it. This is not the GoTo release version.                                                                                                                                                  |
| `url.app`                        | The admin origin, including `http://` or `https://` and any port. No path, trailing slash, query, or fragment. Defaults to `http://localhost:3000`, or `http://localhost:5173` in development. Set it explicitly when using a different origin. |
| `url.worker`                     | The base URL the admin uses to check worker health. Defaults to `http://goto-worker:9000`. It does not set the worker’s listening address.                                                                                                      |
| `appearance.primary_light_color` | Accent color for light mode. Defaults to `'#0f766e'`.                                                                                                                                                                                           |
| `appearance.primary_dark_color`  | Accent color for dark mode. Defaults to `'#5eead4'`. Quote hex colors so YAML doesn’t read `#` as a comment.                                                                                                                                    |
| `database.path`                  | SQLite file for visit data and totals. Defaults to `./data/goto.sqlite`.                                                                                                                                                                        |
| `database.worker_path`           | SQLite file for the worker’s workflow state. Defaults to `./data/worker.sqlite`.                                                                                                                                                                |
| `analytics.retention_months`     | Detailed analytics retention: `0`, `3`, `9`, or `12`. A month is 30 days. The default is `3` (90 days). `0` disables detailed Analytics; lifetime counts continue.                                                                              |

Database paths are relative to the deployment directory above `config/` in the usual layout. Both services need access to the same visit database. The worker’s workflow database must be a different file. The link definitions live in YAML, not in SQLite.

## Authentication

Configure exactly one sign-in method. It protects the admin, not public redirects.

| Setting                                                  | Meaning                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.credentials.username`, `auth.credentials.password` | The shared username and password. Both are required for credential sign-in.                                                                               |
| `auth.oidc.issuer`                                       | The OpenID Connect provider’s issuer URL.                                                                                                                 |
| `auth.oidc.client_id`, `auth.oidc.client_secret`         | The credentials issued by your OIDC provider. Both are required for OIDC sign-in.                                                                         |
| `auth.oidc.name`                                         | Sign-in button label. Defaults to `Single Sign-On`.                                                                                                       |
| `auth.secret`                                            | Optional session secret, at least 32 characters. Set a stable value to keep sessions across restarts. If omitted, GoTo generates one when the app starts. |

For OIDC, register `<url.app>/auth/callback/oidc` as the redirect URI. For example, use `https://go.example.org/auth/callback/oidc` when `url.app` is `https://go.example.org`. GoTo verifies the ID token returned by the provider. Restrict access to the GoTo client at your provider: GoTo does not assign separate admin roles.

Use environment variables for passwords and secrets you don’t want in the YAML file. For example, `password: '${GOTO_ADMIN_PASSWORD}'` reads `GOTO_ADMIN_PASSWORD` from the process environment. `${NAME:-fallback}` supplies a fallback only when the variable is unset. An empty value stays empty. Use `$$` for a literal dollar sign. Substitution applies to string values, not keys.

## Domains, root, and fallback

`domains` is required and maps hostnames to redirect settings. Use `domains: {}` if you have no redirect domains. Each domain requires `links`; use `links: {}` if it has no named links. Include the port for a host that uses a non-default port. List the admin host here if it should also serve short links; GoTo reserves its own app paths on that host.

| Setting                   | Meaning                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `domains.<host>.links`    | Named paths such as `/docs` and their settings.                                                               |
| `domains.<host>.root`     | Optional response for `/`. If omitted, `/` uses the domain’s effective fallback.                              |
| `domains.<host>.fallback` | Optional response for a missing or inactive link on this domain. Overrides the top-level `fallback`.          |
| `fallback`                | Optional default fallback for all domains. Without either fallback, a missing or inactive link returns `404`. |

Root and fallback responses take a required absolute HTTP(S) `url`, a `status_code` (default `302`), and `forward_query` (default `false`). They do not inherit the named-link defaults.

## Named links and defaults

Write the path as it should be matched, starting with `/`. Don’t put `/` itself under `links`; use `root`. Don’t add a trailing slash, use `.` or `..` path segments, or percent-encode characters just to spell a readable path. Keys aren’t percent-decoded by the configuration loader. `/@static/` is reserved.

The following settings can be set globally under `link_defaults`, then overridden under `domains.<host>.link_defaults` or on a link. The most specific value wins, including an explicit `false`.

| Setting                 | Meaning and global default                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `status_code`           | `301`, `302`, `307`, or `308`. Defaults to `302`.                                                                      |
| `case_insensitive`      | Ignore case for ASCII letters only. Defaults to `true`.                                                                |
| `ignore_trailing_slash` | Also match an incoming trailing slash. Defaults to `true`.                                                             |
| `forward_path`          | Match a path below the named link and append the remainder to the destination. Defaults to `false`.                    |
| `forward_query`         | Forward the query string. Incoming values replace destination values for the same parameter name. Defaults to `false`. |

These fields belong to individual links, not `link_defaults`:

| Setting                     | Meaning                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url`                       | Required default destination. Use an absolute HTTP(S) URL without embedded credentials.                                                                                  |
| `title`, `description`      | Optional text for the link.                                                                                                                                              |
| `tags`                      | Optional list of case-sensitive labels. Defaults to an empty list.                                                                                                       |
| `enabled`                   | Defaults to `true`. Set `false` to send requests for this link to the fallback.                                                                                          |
| `valid_from`, `valid_until` | Optional start and end timestamps. Quote an ISO timestamp with seconds and a timezone, such as `'2027-01-01T00:00:00Z'`. Outside the window, the link uses the fallback. |
| `max_visits`                | Optional positive integer limit on successful GET redirects. Omit for no limit. It is best-effort, not a strict quota.                                                   |
| `redirect`                  | Optional ordered list of conditional destinations. Each rule has an `if` and a `to` URL. The first matching rule wins; if none match, GoTo uses `url`.                   |

A redirect rule can match `if.language`, `if.os`, or both. A rule with both conditions requires both to match. A primary language such as `fr` matches `fr` or `fr-CA` in `Accept-Language`; a full tag such as `fr-CA` requires that tag. Language preferences weighted below `0.9` are ignored. Recognized OS values are `ios`, `android`, `windows`, `macos`, `linux`, and `chromeos`.

## Validation and reloads

From a checkout with dependencies installed, run `pnpm cli config validate /path/to/goto.yaml` to validate the YAML and its environment substitutions. Use the same environment values you plan to give the services.

Most valid edits reload automatically. When an edit is rejected, the previous configuration stays active. Stop both services before changing the admin origin, authentication, database paths, reducing retention, or switching detailed Analytics on or off. Start both again with the new configuration.

If you change `.env` values, recreate the Compose containers with `docker compose up --wait --force-recreate` (using the same Compose file as before). Stopping and starting existing containers does not reload their environment.
