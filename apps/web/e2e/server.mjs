import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = process.env.GOTO_E2E_BUILD_DIR;
if (!directory) throw new Error('Missing E2E build directory');

const runtimeDirectory = join(directory, `runtime-${process.pid}`);
await mkdir(join(runtimeDirectory, 'config'), { recursive: true });
process.chdir(runtimeDirectory);
process.env.PROTOCOL_HEADER = 'x-forwarded-proto';
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
await writeFile(
	join(runtimeDirectory, 'config/goto.yaml'),
	JSON.stringify({
		site: { url: 'http://admin.example.test' },
		auth: { credentials: { username: 'example', password: 'e2e-only-password' } },
		domains: {
			'go.example.org': {
				links: {
					'/schema.json': { url: 'https://example.org/public-schema' },
					'/_app/version.json': { url: 'https://example.org/public-asset' },
					'/a/b': { url: 'https://example.org/decoded' },
					'/a%2Fb': { url: 'https://example.org/literal-percent' },
					'/docs': { url: 'https://example.org/first-domain' },
					'/healthz': { url: 'https://example.org/public-health' }
				}
			},
			'tiny.example.org': {
				links: { '/docs': { url: 'https://example.org/second-domain' } }
			}
		}
	})
);

await import(pathToFileURL(join(directory, 'server.js')).href);
