import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { configurationInput } from '../test/configuration.js';
import { ConfigError } from './errors.js';
import { loadConfigFile, parseConfig, loadConfig } from './load.js';

const options = { env: {} };
const yaml = 'auth: {credentials: {username: admin, password: test-password}}\ndomains: {}';
const authoredKeyMarker = 'dummy-authored-key-marker';

describe('configuration loading', () => {
	it('parses YAML and applies configuration defaults without mutating the input', () => {
		expect(parseConfig(`${yaml}\nsite: {title: yes}`, options).configuration.site.title).toBe(
			'yes'
		);
		const input = configurationInput();
		const original = structuredClone(input);
		const { configuration, warnings } = loadConfig(input, options);
		expect(warnings).toEqual([]);
		expect(configuration).toMatchObject({
			version: 1,
			url: { app: 'http://localhost:3000', worker: 'http://goto-worker:9000' },
			site: { title: 'Goto' },
			database: { path: './data/goto.sqlite', worker_path: './data/worker.sqlite' },
			analytics: { retention_months: 3 },
			link_defaults: {
				status_code: 302,
				forward_query: false,
				case_insensitive: true,
				ignore_trailing_slash: true,
				forward_path: false
			}
		});
		expect(input).toEqual(original);
	});

	it('loads ordered conditional destinations with nested interpolation and accepts an empty list', () => {
		const prepared = parseConfig(
			`auth: {credentials: {username: admin, password: test-password}}
domains:
  go.example.com:
    links:
      /docs:
        url: https://example.com/docs
        redirect:
          - if: {language: "\${LANGUAGE}", os: ios}
            to: "\${DESTINATION}"
          - if: {os: linux}
            to: https://example.com/linux
      /ordinary:
        url: https://example.com/ordinary
        redirect: []`,
			{ env: { LANGUAGE: 'fr-CA', DESTINATION: 'https://example.com/fr-ios' } }
		);
		expect(prepared.configuration.domains['go.example.com']?.links['/docs']?.redirect).toEqual([
			{ if: { language: 'fr-CA', os: 'ios' }, to: 'https://example.com/fr-ios' },
			{ if: { os: 'linux' }, to: 'https://example.com/linux' }
		]);
		expect(prepared.domains['go.example.com']?.links['/ordinary']?.redirect).toEqual([]);
	});

	it('rejects an empty condition instead of making a rule unconditional', () => {
		expect(() =>
			loadConfig(
				configurationInput({
					'/docs': {
						url: 'https://example.com/docs',
						redirect: [{ if: {}, to: 'https://example.com/conditional' }]
					}
				}),
				options
			)
		).toThrow(ConfigError);
	});

	it('rejects unsupported conditions instead of silently dropping a routing predicate', () => {
		const input = {
			...configurationInput(),
			domains: {
				'go.example.com': {
					links: {
						'/docs': {
							url: 'https://example.com/docs',
							redirect: [{ if: { language: 'fr', country: 'FR' }, to: 'https://example.com/fr' }]
						}
					}
				}
			}
		};
		expect(() => loadConfig(input, options)).toThrow(ConfigError);
	});

	it('drops unusable string tags while preserving literal names, duplicates and the input', () => {
		const tags = [
			'Work',
			'',
			'work',
			' ',
			'.',
			'..',
			'bad\u0000tag',
			'\ud800',
			' Work ',
			'Work/100%é',
			'Work'
		];
		const input = configurationInput({ '/docs': { url: 'https://example.com/docs', tags } });
		const original = structuredClone(input);
		const prepared = loadConfig(input, options);
		const retained = ['Work', 'work', ' Work ', 'Work/100%é', 'Work'];

		expect(prepared.configuration.domains['go.example.com']?.links['/docs']?.tags).toEqual(
			retained
		);
		expect(prepared.domains['go.example.com']?.links['/docs']?.tags).toEqual(retained);
		expect(prepared.warnings).toEqual([
			{ path: '/domains/*/links/*/tags/1', message: 'Dropped tag: expected nonblank text' },
			{ path: '/domains/*/links/*/tags/3', message: 'Dropped tag: expected nonblank text' },
			{ path: '/domains/*/links/*/tags/4', message: 'Dropped tag: dot segments are not allowed' },
			{ path: '/domains/*/links/*/tags/5', message: 'Dropped tag: dot segments are not allowed' },
			{
				path: '/domains/*/links/*/tags/6',
				message: 'Dropped tag: ASCII control characters are not allowed'
			},
			{
				path: '/domains/*/links/*/tags/7',
				message: 'Dropped tag: malformed Unicode is not allowed'
			}
		]);
		expect(input).toEqual(original);
	});

	it('keeps links whose tags are all dropped and defaults omitted tags without warnings', () => {
		const prepared = loadConfig(
			configurationInput({
				'/bad': { url: 'https://example.com/bad', tags: ['', '..'] },
				'/omitted': { url: 'https://example.com/omitted' }
			}),
			options
		);
		expect(prepared.domains['go.example.com']?.links['/bad']?.tags).toEqual([]);
		expect(prepared.domains['go.example.com']?.links['/omitted']?.tags).toEqual([]);
		expect(prepared.warnings).toHaveLength(2);
		expect(loadConfig(configurationInput(), options).warnings).toEqual([]);
	});

	it('cleans tags after interpolation without tolerating missing variables or unrelated errors', () => {
		const input = configurationInput({
			'/docs': { url: 'https://example.com/docs', tags: ['${TAG}', '${OTHER:- Work }'] }
		});
		const prepared = loadConfig(input, { env: { TAG: 'bad\u007ftag' } });
		expect(prepared.domains['go.example.com']?.links['/docs']?.tags).toEqual([' Work ']);
		expect(prepared.warnings).toEqual([
			{
				path: '/domains/*/links/*/tags/0',
				message: 'Dropped tag: ASCII control characters are not allowed'
			}
		]);
		expect(() => loadConfig(input, options)).toThrow(ConfigError);
		expect(() => loadConfig({ ...input, site: null }, { env: { TAG: '.' } })).toThrow(ConfigError);
	});

	it.each([null, {}, 'work', ['work', 42], [false], [null], [{}]])(
		'rejects malformed tag containers and nonstring items %j',
		(tags) => {
			const input = {
				...configurationInput(),
				domains: {
					'go.example.com': { links: { '/docs': { url: 'https://example.com/docs', tags } } }
				}
			};
			expect(() => loadConfig(input, options)).toThrow(ConfigError);
		}
	);

	it.each([0, 3, 9, 12])('accepts the finite analytics retention %s', (retention_months) => {
		const input = { ...configurationInput(), analytics: { retention_months } };
		expect(loadConfig(input, options).configuration.analytics.retention_months).toBe(
			retention_months
		);
	});

	it.each([1, 6, Infinity, '3'])(
		'rejects unsupported analytics retention %j',
		(retention_months) => {
			expect(() =>
				loadConfig({ ...configurationInput(), analytics: { retention_months } }, options)
			).toThrow(ConfigError);
		}
	);

	it('rejects the replaced analytics switches instead of silently ignoring them', () => {
		expect(() =>
			loadConfig(
				{
					...configurationInput(),
					analytics: { enabled: false, retention_days: 90 }
				},
				options
			)
		).toThrow(ConfigError);
	});

	it.each([
		[{}, 'http://localhost:3000'],
		[{ NODE_ENV: 'development' }, 'http://localhost:5173'],
		[{ NODE_ENV: 'production' }, 'http://localhost:3000'],
		[{ PORT: '4321' }, 'http://localhost:4321'],
		[{ PORT: '80' }, 'http://localhost']
	])('derives an omitted origin from injected environment %j', (env, url) => {
		expect(loadConfig(configurationInput(), { env }).configuration.url.app).toBe(url);
	});

	it('validates interpolated values and preserves an explicit canonical origin', () => {
		const input = {
			...configurationInput({ '/docs': { url: '${DESTINATION}' } }),
			url: { app: '${ADMIN_ORIGIN}', worker: '${WORKER_BASE}' },
			auth: { ...configurationInput().auth, secret: '${SECRET}' }
		};
		const env = {
			ADMIN_ORIGIN: 'https://admin.example.com',
			WORKER_BASE: 'http://worker.example.com:9100/private/',
			DESTINATION: 'https://example.com',
			SECRET: 's'.repeat(32),
			PORT: 'invalid'
		};
		const { configuration } = loadConfig(input, { env });
		expect(configuration.url).toEqual({ app: env.ADMIN_ORIGIN, worker: env.WORKER_BASE });
		expect(configuration.auth.secret).toBe(env.SECRET);
		expect(() =>
			loadConfig(input, { env: { ...env, WORKER_BASE: 'http://worker.example.com?secret' } })
		).toThrowError(
			expect.objectContaining({ constructor: ConfigError, message: 'Invalid configuration' })
		);
		for (const destination of [
			'https://private:secret@example.com',
			'https://example.com/\r\nsecret'
		]) {
			expect(() => loadConfig(input, { env: { ...env, DESTINATION: destination } })).toThrowError(
				expect.objectContaining({ constructor: ConfigError, message: 'Invalid configuration' })
			);
		}
		expect(() =>
			loadConfig({ ...input, auth: { ...input.auth, secret: '${MISSING}' } }, { env })
		).toThrowError(new ConfigError());
	});

	it('defaults omitted URL fields independently', () => {
		const input = configurationInput();
		expect(loadConfig({ ...input, url: {} }, options).configuration.url).toEqual({
			app: 'http://localhost:3000',
			worker: 'http://goto-worker:9000'
		});
		expect(
			loadConfig({ ...input, url: { app: 'https://admin.example.com' } }, options).configuration.url
				.worker
		).toBe('http://goto-worker:9000');
		expect(
			loadConfig(
				{ ...input, url: { worker: 'https://worker.example.com/private/' } },
				{ env: { NODE_ENV: 'development' } }
			).configuration.url
		).toEqual({ app: 'http://localhost:5173', worker: 'https://worker.example.com/private/' });
	});

	it.each([
		'ftp://worker.example.com',
		'http://user:password@worker.example.com',
		'http://@worker.example.com',
		'http://worker.example.com?token=secret',
		'http://worker.example.com?',
		'http://worker.example.com#fragment',
		'http://worker.example.com#',
		'http://worker.example.com/private path'
	])('rejects invalid worker base URLs %j', (worker) => {
		expect(() => loadConfig({ ...configurationInput(), url: { worker } }, options)).toThrow(
			ConfigError
		);
	});

	it('rejects the old site URL key without accepting it as an app URL', () => {
		for (const url of [undefined, { app: 'https://admin.example.com' }]) {
			expect(() =>
				loadConfig(
					{
						...configurationInput(),
						...(url === undefined ? {} : { url }),
						site: { url: 'https://old.example.com', title: 'Custom title' }
					},
					options
				)
			).toThrow(ConfigError);
		}
	});

	it('defaults the OIDC name after resolving authentication placeholders', () => {
		const env = {
			SECRET: 's'.repeat(32),
			ISSUER: 'https://id.example.com',
			CLIENT_ID: 'goto',
			CLIENT_SECRET: 'test-client-secret'
		};
		const { configuration } = loadConfig(
			{
				...configurationInput(),
				auth: {
					secret: '${SECRET}',
					oidc: {
						issuer: '${ISSUER}',
						client_id: '${CLIENT_ID}',
						client_secret: '${CLIENT_SECRET}'
					}
				}
			},
			{ env }
		);
		expect(configuration.auth).toEqual({
			secret: env.SECRET,
			oidc: {
				issuer: env.ISSUER,
				client_id: env.CLIENT_ID,
				client_secret: env.CLIENT_SECRET,
				name: 'Single Sign-On'
			}
		});
	});

	it.each(['0', '65536', 'abc', '3000\n'])('rejects invalid inferred ports %j', (PORT) => {
		expect(() => loadConfig(configurationInput(), { env: { PORT } })).toThrowError(
			new ConfigError()
		);
	});

	it('normalizes root and fallback responses independently of link defaults', () => {
		const input = {
			...configurationInput(),
			link_defaults: { status_code: 308, forward_query: true },
			fallback: { url: '${FALLBACK}' },
			domains: {
				'go.example.com': {
					link_defaults: { status_code: 307, forward_query: true },
					root: { url: '${ROOT}' },
					links: {}
				}
			}
		};
		const original = structuredClone(input);
		const { configuration, domains } = loadConfig(input, {
			env: { ROOT: 'https://example.com', FALLBACK: 'https://example.com/missing' }
		});
		expect(configuration.fallback).toEqual({
			url: 'https://example.com/missing',
			status_code: 302,
			forward_query: false
		});
		expect(domains['go.example.com']?.root).toEqual({
			url: 'https://example.com',
			status_code: 302,
			forward_query: false
		});
		expect(input).toEqual(original);
	});

	it.each([
		404,
		'https://example.com/missing',
		false,
		null,
		{},
		{ url: 'https://example.com', status_code: 404 },
		{ url: 'https://example.com', forward_query: 'false' },
		{ url: 'https://example.com', action: 'not_found' },
		{ url: 'https://example.com', forward_path: true }
	])('rejects non-response fallback values %j', (fallback) => {
		expect(() => loadConfig({ ...configurationInput(), fallback }, options)).toThrow(ConfigError);
	});

	it('restricts root and domain fallback to redirect responses and rejects old defaults', () => {
		const input = configurationInput();
		for (const domain of [
			{ root: { url: 'https://example.com', enabled: false } },
			{ root: { url: 'https://example.com', valid_from: '2027-01-01T00:00:00Z' } },
			{ root: { url: 'https://example.com', ignore_trailing_slash: true } },
			{ fallback: { url: 'https://example.com', case_insensitive: true } },
			{ fallback: 404 },
			{ defaults: { status_code: 307 } },
			{ link_defaults: { fallback: 'https://example.com' } }
		]) {
			expect(() =>
				loadConfig(
					{
						...input,
						domains: { 'go.example.com': { ...domain, links: {} } }
					},
					options
				)
			).toThrow(ConfigError);
		}
		expect(() => loadConfig({ ...input, defaults: { status_code: 307 } }, options)).toThrow(
			ConfigError
		);
		expect(() => loadConfig({ ...input, link_defaults: { fallback: 404 } }, options)).toThrow(
			ConfigError
		);
	});

	it.each([
		{ unknown: 'private-value' },
		{ site: null },
		{ site: [] },
		{ url: null },
		{ url: [] },
		{ version: Infinity },
		{ auth: {} },
		{
			auth: {
				credentials: { username: 'admin', password: 'password' },
				oidc: { issuer: 'https://id.example.com', client_id: 'goto', client_secret: 'secret' }
			}
		},
		{ auth: { ...configurationInput().auth, secret: 'too-short-private-secret' } },
		{ url: { app: 'https://ADMIN.example.com/' } },
		{ link_defaults: { forward_query: null } },
		{ link_defaults: { case_insensitive: 'false' } },
		{
			domains: {
				'go.example.com': { link_defaults: { ignore_trailing_slash: null }, links: {} }
			}
		},
		{
			domains: {
				'go.example.com': {
					links: { '/docs': { url: 'https://example.com', forward_path: 'true' } }
				}
			}
		},
		{ domains: [] },
		{ domains: { 'go.example.com': { links: [] } } },
		{
			domains: {
				'go.example.com': { links: { '/docs': { url: 'https://example.com', tags: {} } } }
			}
		},
		{
			domains: {
				'go.example.com': { links: { '/docs': { url: 'https://example.com', fallback: 404 } } }
			}
		}
	])('rejects strict schema violations %j', (override) => {
		expect(() => loadConfig({ ...configurationInput(), ...override }, options)).toThrow(
			ConfigError
		);
	});

	it.each([
		{
			name: 'password mapping',
			override: {
				auth: { credentials: { username: 'admin', password: { [authoredKeyMarker]: null } } }
			}
		},
		{ name: 'unknown option', override: { [authoredKeyMarker]: 'value' } },
		{ name: 'missing variable', override: { [authoredKeyMarker]: '${MISSING}' } }
	])('keeps authored keys out of generic errors for $name', ({ override }) => {
		let error: unknown;
		try {
			loadConfig({ ...configurationInput(), ...override }, options);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(ConfigError);
		expect(error).toHaveProperty('message', 'Invalid configuration');
		expect(error).not.toHaveProperty('path');
		expect(JSON.stringify(error)).not.toContain(authoredKeyMarker);
	});

	it.each([
		`${yaml}\nversion: 1\nversion: 1`,
		`${yaml}\n<<: {version: 1}`,
		`${yaml}\n---\n${yaml}`,
		`${yaml}\nsite: &cycle {title: *cycle}`
	])('rejects non-strict YAML', (source) => {
		expect(() => parseConfig(source, options)).toThrow(ConfigError);
	});

	it('converts numeric YAML domain keys to strings before normalizing hosts', () => {
		const { configuration, domains } = parseConfig(
			yaml.replace('domains: {}', 'domains: {1: {links: {}}}'),
			options
		);
		expect(Object.keys(configuration.domains)).toEqual(['1']);
		expect(Object.keys(domains)).toEqual(['0.0.0.1']);
	});

	it('does not expose YAML parser snippets containing secrets', () => {
		let error: unknown;
		try {
			parseConfig(`${yaml}\nauth: private-secret`, options);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(ConfigError);
		expect(error).toHaveProperty('message', 'Invalid configuration');
		expect(JSON.stringify(error)).not.toContain('private-secret');
	});

	it('allows small aliases but bounds repeated expansion', () => {
		const source = `${yaml.replace('domains: {}', '')}domains:\n  go.example.com:\n    links:\n      /base: &link {url: https://example.com}\n`;
		expect(
			parseConfig(`${source}      /alias: *link`, options).domains['go.example.com']?.links[
				'/alias'
			]
		).toMatchObject({ url: 'https://example.com' });
		const aliases = Array.from({ length: 101 }, (_, index) => `      /link${index}: *link`).join(
			'\n'
		);
		expect(() => parseConfig(source + aliases, options)).toThrowError(new ConfigError());
	});

	it('rejects getters without executing them, cycles and unsafe prototypes or keys', () => {
		let calls = 0;
		const getter = {
			...configurationInput(),
			get site() {
				calls++;
				return {};
			}
		};
		expect(() => loadConfig(getter, options)).toThrow(ConfigError);
		expect(calls).toBe(0);
		const cycle = configurationInput();
		Object.assign(cycle, { site: cycle });
		for (const input of [
			cycle,
			Object.create(configurationInput()),
			{ ...configurationInput(), constructor: 'unsafe' },
			null,
			[]
		]) {
			expect(() => loadConfig(input, options)).toThrow(ConfigError);
		}
	});

	it('validates the shipped example with explicit environment values', async () => {
		const path = fileURLToPath(new URL('../../../examples/goto.yaml', import.meta.url));
		const prepared = await loadConfigFile(path, {
			env: {
				GOTO_AUTH_SECRET: 'example-session-secret-with-at-least-thirty-two-characters',
				GOTO_OIDC_CLIENT_SECRET: 'example-client-secret'
			}
		});
		expect(prepared.configuration.analytics.retention_months).toBe(3);
		expect(prepared.domains['go.example.org']).toMatchObject({
			root: { url: 'https://example.org', status_code: 308, forward_query: false },
			fallback: { url: 'https://example.org/unavailable', status_code: 302, forward_query: false }
		});
		expect(prepared.domains['tiny.example.com']?.fallback).toEqual({
			url: 'https://example.net/unavailable',
			status_code: 307,
			forward_query: true
		});
		expect(prepared.domains['go.example.org']?.links['/docs']).toMatchObject({
			forward_query: false,
			forward_path: true,
			provenance: { forward_query: 'link', forward_path: 'link' }
		});
	});

	it('loads CONFIG_PATH relative to cwd and roots the database at the config directory parent', async () => {
		const root = await mkdtemp(join(tmpdir(), 'goto-config-'));
		try {
			const configDirectory = join(root, 'deployment', 'config');
			await mkdir(configDirectory, { recursive: true });
			await writeFile(
				join(configDirectory, 'custom.yaml'),
				JSON.stringify({
					...configurationInput(),
					database: {
						path: './data/custom.sqlite',
						worker_path: './data/custom-worker.sqlite'
					}
				})
			);
			const loaded = await loadConfigFile(undefined, {
				cwd: root,
				env: { CONFIG_PATH: 'deployment/config/custom.yaml' }
			});
			expect(loaded.configuration.database.path).toBe(join(root, 'deployment/data/custom.sqlite'));
			expect(loaded.configuration.database.worker_path).toBe(
				join(root, 'deployment/data/custom-worker.sqlite')
			);
			const explicit = await loadConfigFile('deployment/config/custom.yaml', {
				cwd: root,
				env: { CONFIG_PATH: 'missing.yaml' }
			});
			expect(explicit).toEqual(loaded);
			await expect(
				loadConfigFile('missing-private-file.yaml', { cwd: root, env: {} })
			).rejects.toThrowError(
				expect.objectContaining({ constructor: ConfigError, message: 'Invalid configuration' })
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
