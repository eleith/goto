# Development

Read the [philosophy](philosophy.md). Keep changes small.

With Docker Compose, run from `apps/web`:

```sh
mkdir -p config data
cp -n ../../examples/goto.yaml config/goto.yaml
```

Edit `config/goto.yaml` before starting. Set `url.app` to `http://localhost:5173` and configure `localhost:5173` as a domain if you want to try redirects on the same host. Replace the example OIDC block with development credentials or configure your own provider. Set the referenced secrets in `apps/web/.env`, or omit `auth.secret` for a throwaway local session secret. See the [configuration reference](config.md) for the fields.

Make `data/` writable by the container user. The default UID and GID are `1000:1000`; on Linux, set `LOCAL_UID` and `LOCAL_GID` in the Compose environment to match your user if they differ.

```sh
docker compose -f docker-compose.dev.yml up --build --wait
```

Open [the admin](http://localhost:5173/admin). The dev Compose setup runs the web app and worker; the web app hot-reloads as you edit. If you have mise and fnox, `mise run docker -- up --build --wait` wraps the same Compose command. See [Testing](testing.md) for checks.
