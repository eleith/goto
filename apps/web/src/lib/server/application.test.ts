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
import { createVisitRecorder } from './visits/recorder.js';

vi.mock('./auth/index.js', () => ({ createAuthentication: vi.fn(() => ({})) }));
vi.mock('./visits/recorder.js', () => ({ createVisitRecorder: vi.fn() }));

vi.mock('@goto/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@goto/config')>()),
	loadConfigFile: vi.fn(),
	startConfigReloading: vi.fn()
}));

type ReloadOptions = Parameters<typeof startConfigReloading<PreparedConfiguration>>[0];
const options = { cwd: '/deployment', env: {} };
let reload: ReloadOptions;
const stop = vi.fn();
const stopRecorder = vi.fn();
const recordVisit = vi.fn();

function prepared(
	destination = 'https://example.org/first',
	changes: Record<string, unknown> = {}
) {
	return validateConfig(
		{
			url: { app: 'https://admin.example.test' },
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
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.mocked(loadConfigFile).mockResolvedValue(prepared());
	vi.mocked(createVisitRecorder).mockReturnValue({ recordVisit, stop: stopRecorder });
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
	expect(createVisitRecorder).toHaveBeenCalledExactlyOnceWith('/deployment/data/goto.sqlite');
	expect(application.recordVisit).toBe(recordVisit);
	expect(stopRecorder).toHaveBeenCalledOnce();
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
	expect(createVisitRecorder).toHaveBeenCalledOnce();
	expect(console.warn).toHaveBeenCalledExactlyOnceWith(
		'Invalid configuration update; keeping current configuration'
	);
	await application.close?.();
});

test.each([
	{ url: { app: 'https://different-admin.example.test' } },
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

test('rejects live collection disable and the rest of its candidate until coordinated restart', async () => {
	const application = await createApplication(options);
	const initial = application.currentSnapshot();
	const next = prepared('https://example.org/blocked', { analytics: { retention_months: 0 } });
	expect(reload.onChange(next, prepared())).toBe(false);
	expect(application.currentSnapshot()).toBe(initial);
	expect(createVisitRecorder).toHaveBeenCalledOnce();
	expect(console.warn).toHaveBeenCalledExactlyOnceWith(
		'Analytics collection change requires coordinated restart; keeping current configuration'
	);
	await application.close?.();
});

test('zero startup creates no recorder and rejects live enabling', async () => {
	const initial = prepared('https://example.org/first', { analytics: { retention_months: 0 } });
	vi.mocked(loadConfigFile).mockResolvedValueOnce(initial);
	const application = await createApplication(options);
	const snapshot = application.currentSnapshot();
	expect(createVisitRecorder).not.toHaveBeenCalled();
	expect(application.recordVisit).toBeUndefined();
	expect(reload.onChange(prepared('https://example.org/blocked'), initial)).toBe(false);
	expect(application.currentSnapshot()).toBe(snapshot);
	await application.close?.();
	expect(stopRecorder).not.toHaveBeenCalled();
});

test('changes positive retention live without replacing the recorder', async () => {
	const application = await createApplication(options);
	const next = prepared('https://example.org/second', { analytics: { retention_months: 9 } });
	expect(reload.onChange(next, prepared())).toBe(true);
	expect(application.currentSnapshot().configuration.analytics.retention_months).toBe(9);
	expect(createVisitRecorder).toHaveBeenCalledOnce();
	await application.close?.();
});

test('closes the recorder if configuration monitoring cannot start', async () => {
	vi.mocked(startConfigReloading).mockRejectedValueOnce(new Error('Monitor startup failed'));
	await expect(createApplication(options)).rejects.toThrow('Monitor startup failed');
	expect(stopRecorder).toHaveBeenCalledOnce();
});

test('invalid startup fails before registering a monitor', async () => {
	vi.mocked(loadConfigFile).mockRejectedValue(new ConfigError());

	await expect(createApplication(options)).rejects.toThrow('Invalid configuration');
	expect(console.error).toHaveBeenCalledExactlyOnceWith('Invalid configuration');
	expect(startConfigReloading).not.toHaveBeenCalled();
	expect(createVisitRecorder).not.toHaveBeenCalled();
});

test('reports only curated configuration issues during startup', async () => {
	const failure = new ConfigError([
		{ path: '/url/app', message: 'Expected a canonical app origin' }
	]);
	failure.cause = new Error('private startup detail');
	vi.mocked(loadConfigFile).mockRejectedValue(failure);

	await expect(createApplication(options)).rejects.toBe(failure);
	expect(console.error).toHaveBeenCalledExactlyOnceWith(
		'Invalid configuration\n  /url/app: Expected a canonical app origin'
	);
	expect(startConfigReloading).not.toHaveBeenCalled();
	expect(createVisitRecorder).not.toHaveBeenCalled();
});

test('does not expose arbitrary startup errors as configuration diagnostics', async () => {
	const failure = new Error('private connection detail');
	vi.mocked(loadConfigFile).mockRejectedValue(failure);

	await expect(createApplication(options)).rejects.toBe(failure);
	expect(console.error).not.toHaveBeenCalled();
});
