import {
	ConfigError,
	loadConfigFile,
	startConfigReloading,
	validateConfig,
	type PreparedConfiguration
} from '@goto/config';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApplication } from './application.js';
import { createAuthentication } from './auth/index.js';

vi.mock('./auth/index.js', () => ({ createAuthentication: vi.fn(() => ({})) }));

vi.mock('@goto/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@goto/config')>()),
	loadConfigFile: vi.fn(),
	startConfigReloading: vi.fn()
}));

type ReloadOptions = Parameters<typeof startConfigReloading<PreparedConfiguration>>[0];
const options = { cwd: '/deployment', env: {} };
let reload: ReloadOptions;
const stop = vi.fn();

function prepared(
	destination = 'https://example.org/first',
	changes: Record<string, unknown> = {}
) {
	return validateConfig(
		{
			site: { url: 'https://admin.example.test' },
			auth: { credentials: { username: 'example', password: 'test-only-password' } },
			domains: { 'go.example.test': { links: { '/docs': { url: destination } } } },
			...changes
		},
		{ env: {} }
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.mocked(loadConfigFile).mockResolvedValue(prepared());
	vi.mocked(startConfigReloading).mockImplementation(async (options) => {
		reload = options as ReloadOptions;
		return stop;
	});
});

afterEach(() => vi.restoreAllMocks());

test('uses a fixed path/environment and stops monitoring with the application', async () => {
	const env = { CONFIG_PATH: 'config/goto.yaml', VALUE: 'initial' };
	const application = await createApplication({ cwd: options.cwd, env });
	env.VALUE = 'changed';
	await reload.load(reload.path);

	expect(reload.path).toBe('/deployment/config/goto.yaml');
	expect(loadConfigFile).toHaveBeenLastCalledWith(reload.path, {
		cwd: options.cwd,
		env: { CONFIG_PATH: 'config/goto.yaml', VALUE: 'initial' }
	});
	expect(application.currentSnapshot().configuration.auth).not.toHaveProperty('secret');
	await application.close?.();
	expect(stop).toHaveBeenCalledOnce();
});

test('publishes valid changes, ignores equivalent data, and retains last good data on failure', async () => {
	const application = await createApplication(options);
	const initial = application.currentSnapshot();
	expect(reload.onChange(prepared(), prepared())).toBe(true);
	expect(application.currentSnapshot()).toBe(initial);
	const next = prepared('https://example.org/second');
	expect(reload.onChange(next, prepared())).toBe(true);
	const accepted = application.currentSnapshot();
	expect(accepted).not.toBe(initial);
	expect(accepted.domains['go.example.test']?.links['/docs']?.url).toBe(
		'https://example.org/second'
	);
	reload.onError(new Error('private-parser-detail'));
	expect(application.currentSnapshot()).toBe(accepted);
	expect(createAuthentication).toHaveBeenCalledOnce();
	expect(console.warn).toHaveBeenCalledExactlyOnceWith(
		'Invalid configuration update; keeping current configuration'
	);
	await application.close?.();
});

test.each([
	{ site: { url: 'https://different-admin.example.test' } },
	{ auth: { credentials: { username: 'changed', password: 'private-changed-password' } } },
	{ database: { path: './data/different.sqlite' } }
])('rejects the whole candidate when startup settings change: %j', async (changes) => {
	const application = await createApplication(options);
	const initial = application.currentSnapshot();

	expect(reload.onChange(prepared('https://example.org/blocked', changes), prepared())).toBe(false);

	expect(application.currentSnapshot()).toBe(initial);
	expect(console.warn).toHaveBeenCalledExactlyOnceWith(
		'Configuration change requires restart; keeping current configuration'
	);
	await application.close?.();
});

test('invalid startup fails before registering a monitor', async () => {
	vi.mocked(loadConfigFile).mockRejectedValue(new ConfigError());

	await expect(createApplication(options)).rejects.toThrow('Invalid configuration');
	expect(startConfigReloading).not.toHaveBeenCalled();
});
