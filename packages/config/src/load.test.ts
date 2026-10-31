import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configurationInput } from '../test/configuration.js';
import { ConfigError } from './errors.js';
import { loadConfigFile, parseConfig, validateConfig } from './load.js';

const options = { env: {} };
const yaml = 'auth: {credentials: {username: admin, password: test-password}}\ndomains: {}';
const authoredKeyMarker = 'dummy-authored-key-marker';

describe('configuration loading', () => {
	it('parses YAML 1.2 and applies root defaults without mutating the input', () => {
		expect(parseConfig(`${yaml}\nsite: {title: yes}`, options).configuration.site.title).toBe(
			'yes'
		);
		const input = configurationInput();
		const original = structuredClone(input);
		const { configuration } = validateConfig(input, options);
		expect(configuration).toMatchObject({
			version: 1,
			site: { url: 'http://localhost:3000', title: 'Goto' },
			database: { path: './data/goto.sqlite' },
			analytics: { enabled: true, retention_days: 90 },
			defaults: { status_code: 302, forward_query: false, fallback: 404 }
		});
		expect(input).toEqual(original);
	});

	it.each([
		[{}, 'http://localhost:3000'],
		[{ NODE_ENV: 'development' }, 'http://localhost:5173'],
		[{ NODE_ENV: 'production' }, 'http://localhost:3000'],
		[{ PORT: '4321' }, 'http://localhost:4321'],
		[{ PORT: '80' }, 'http://localhost']
	])('derives an omitted origin from injected environment %j', (env, url) => {
		expect(validateConfig(configurationInput(), { env }).configuration.site.url).toBe(url);
	});

	it('validates interpolated values and preserves an explicit canonical origin', () => {
		const input = {
			...configurationInput({ '/docs': { url: '${DESTINATION}' } }),
			site: { url: '${ADMIN_ORIGIN}' },
			auth: { ...configurationInput().auth, secret: '${SECRET}' }
		};
		const env = {
			ADMIN_ORIGIN: 'https://admin.example.com',
			DESTINATION: 'https://example.com',
			SECRET: 's'.repeat(32),
			PORT: 'invalid'
		};
		const { configuration } = validateConfig(input, { env });
		expect(configuration.site.url).toBe(env.ADMIN_ORIGIN);
		expect(configuration.auth.secret).toBe(env.SECRET);
		for (const destination of [
			'https://private:secret@example.com',
			'https://example.com/\r\nsecret'
		]) {
			expect(() =>
				validateConfig(input, { env: { ...env, DESTINATION: destination } })
			).toThrowError(new ConfigError());
		}
		expect(() =>
			validateConfig({ ...input, auth: { ...input.auth, secret: '${MISSING}' } }, { env })
		).toThrowError(new ConfigError());
	});

	it('defaults the OIDC name after resolving authentication placeholders', () => {
		const env = {
			SECRET: 's'.repeat(32),
			ISSUER: 'https://id.example.com',
			CLIENT_ID: 'goto',
			CLIENT_SECRET: 'test-client-secret'
		};
		const { configuration } = validateConfig(
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
		expect(() => validateConfig(configurationInput(), { env: { PORT } })).toThrowError(
			new ConfigError()
		);
	});

	it.each([
		{ unknown: 'private-value' },
		{ site: null },
		{ site: [] },
		{ version: Infinity },
		{ auth: {} },
		{
			auth: {
				credentials: { username: 'admin', password: 'password' },
				oidc: { issuer: 'https://id.example.com', client_id: 'goto', client_secret: 'secret' }
			}
		},
		{ auth: { ...configurationInput().auth, secret: 'too-short-private-secret' } },
		{ site: { url: 'https://ADMIN.example.com/' } },
		{ defaults: { forward_query: null } },
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
		expect(() => validateConfig({ ...configurationInput(), ...override }, options)).toThrow(
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
			validateConfig({ ...configurationInput(), ...override }, options);
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
		`%YAML 1.1\n---\n${yaml}`,
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
		expect(() => parseConfig(`${yaml}\nauth: private-secret`, options)).toThrowError(
			new ConfigError()
		);
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
		expect(() => validateConfig(getter, options)).toThrow(ConfigError);
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
			expect(() => validateConfig(input, options)).toThrow(ConfigError);
		}
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
					database: { path: './data/custom.sqlite' }
				})
			);
			const loaded = await loadConfigFile(undefined, {
				cwd: root,
				env: { CONFIG_PATH: 'deployment/config/custom.yaml' }
			});
			expect(loaded.configuration.database.path).toBe(join(root, 'deployment/data/custom.sqlite'));
			const explicit = await loadConfigFile('deployment/config/custom.yaml', {
				cwd: root,
				env: { CONFIG_PATH: 'missing.yaml' }
			});
			expect(explicit).toEqual(loaded);
			await expect(
				loadConfigFile('missing-private-file.yaml', { cwd: root, env: {} })
			).rejects.toThrowError(new ConfigError());
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
