import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = process.env.GOTO_E2E_BUILD_DIR;
if (!directory) throw new Error('Missing E2E build directory');

const server = createServer();

function shutdown() {
	server.close(() => process.exit(0));
	server.closeIdleConnections();
	setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('disconnect', shutdown);

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://localhost:${server.address().port}`;
process.env.PROTOCOL_HEADER = 'x-forwarded-proto';
const runtimeDirectory = join(directory, `runtime-${process.pid}`);
await mkdir(join(runtimeDirectory, 'config'), { recursive: true });
process.chdir(runtimeDirectory);
await writeFile(
	join(runtimeDirectory, 'config/goto.yaml'),
	JSON.stringify({
		site: { url: origin },
		auth: { credentials: { username: 'example', password: 'e2e-only-password' } },
		domains: {
			'go.example.org': { links: { '/schema.json': { url: 'https://example.org/documentation' } } }
		}
	})
);

const { handler } = await import(pathToFileURL(join(directory, 'build/handler.js')).href);
server.on('request', (request, response) => {
	request.headers['x-forwarded-proto'] = 'http';
	handler(request, response);
});

process.send({ origin });
