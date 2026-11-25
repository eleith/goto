import { ConfigError, loadConfigFile, startConfigReloading, loadConfig } from '@goto/config';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApplication } from './application.js';
import { createAuthentication } from './auth/index.js';
import { createVisitWriter } from './visits/writer.js';
import { readStoredLinkVisitCounts } from './visits/counts.js';
import { handleIngress } from './dispatch.js';
import type { IncomingMessage } from 'node:http';

vi.mock('./auth/index.js', () => ({ createAuthentication: vi.fn(() => ({})) }));
vi.mock('./visits/writer.js', () => ({ createVisitWriter: vi.fn() }));
vi.mock('./visits/counts.js', () => ({ readStoredLinkVisitCounts: vi.fn() }));

vi.mock('@goto/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@goto/config')>()),
	loadConfigFile: vi.fn(),
	startConfigReloading: vi.fn()
}));

type ReloadOptions = Parameters<typeof startConfigReloading>[0];
const options = { cwd: '/deployment', env: {} };
let reload: ReloadOptions;
const stop = vi.fn();
const stopVisitWriter = vi.fn();
const queueVisit = vi.fn();
const waitUntilReady = vi.fn();

function prepared(
	destination = 'https://example.org/first',
	changes: Record<string, unknown> = {}
) {
	return loadConfig(
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
	waitUntilReady.mockResolvedValue(undefined);
	stopVisitWriter.mockResolvedValue(undefined);
	vi.mocked(readStoredLinkVisitCounts).mockResolvedValue([]);
	vi.mocked(createVisitWriter).mockReturnValue({
		waitUntilReady,
		queueVisit,
		stop: stopVisitWriter
	});
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
	expect(createVisitWriter).toHaveBeenCalledExactlyOnceWith('/deployment/data/goto.sqlite');
	expect(application.recordVisit).toEqual(expect.any(Function));
	expect(waitUntilReady).toHaveBeenCalledOnce();
	expect(readStoredLinkVisitCounts).toHaveBeenCalledExactlyOnceWith(
		'/deployment/data/goto.sqlite',
		[{ domain: 'go.example.test', path: '/docs' }]
	);
	expect(stopVisitWriter).toHaveBeenCalledOnce();
});

test('publishes valid changes, ignores equivalent data, and retains last good data on failure', async () => {
	const application = await createApplication(options);
	const initial = application.currentSnapshot();
	expect(await reload.onChange(prepared(), prepared())).toBe(true);
	expect(application.currentSnapshot()).toBe(initial);
	const next = prepared('https://example.org/second');
	expect(await reload.onChange(next, prepared())).toBe(true);
	const accepted = application.currentSnapshot();
	expect(accepted).not.toBe(initial);
	expect(accepted.domains['go.example.test']?.links['/docs']?.url).toBe(
		'https://example.org/second'
	);
	reload.onError(new Error('private-parser-detail'));
	expect(application.currentSnapshot()).toBe(accepted);
	expect(createAuthentication).toHaveBeenCalledOnce();
	expect(createVisitWriter).toHaveBeenCalledOnce();
	expect(console.warn).toHaveBeenCalledExactlyOnceWith(
		'Invalid configuration update; previous configuration remains active until a valid update is loaded'
	);
	await application.close?.();
});

test('starts minimal visit writing with zero retention', async () => {
	const initial = prepared('https://example.org/first', { analytics: { retention_months: 0 } });
	vi.mocked(loadConfigFile).mockResolvedValueOnce(initial);
	const application = await createApplication(options);
	expect(createVisitWriter).toHaveBeenCalledOnce();
	expect(application.recordVisit).toEqual(expect.any(Function));
	expect(readStoredLinkVisitCounts).toHaveBeenCalledOnce();
	expect(send(application, '/docs')?.status).toBe(302);
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(1);
	expect(queueVisit).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({
			path: '/docs',
			ip: null,
			user_agent: null,
			accept_language: null
		})
	);
	await application.close?.();
	expect(stopVisitWriter).toHaveBeenCalledOnce();
});

test('changes positive retention live without restarting visit writing', async () => {
	const application = await createApplication(options);
	const next = prepared('https://example.org/second', { analytics: { retention_months: 9 } });
	expect(await reload.onChange(next, prepared())).toBe(true);
	expect(application.currentSnapshot().configuration.analytics.retention_months).toBe(9);
	expect(createVisitWriter).toHaveBeenCalledOnce();
	await application.close?.();
});

test('reports tag warnings at startup and only changed warnings on accepted reloads', async () => {
	const warning = { path: '/domains/*/links/*/tags/0', message: 'Ignored blank tag' };
	const initial = { ...prepared(), warnings: [warning] };
	vi.mocked(loadConfigFile).mockResolvedValueOnce(initial);
	const application = await createApplication(options);
	expect(console.warn).toHaveBeenCalledExactlyOnceWith(
		'Configuration warnings\n  /domains/*/links/*/tags/0: Ignored blank tag'
	);
	expect(await reload.onChange(structuredClone(initial), initial)).toBe(true);
	expect(console.warn).toHaveBeenCalledOnce();

	const next = {
		...prepared('https://example.org/second'),
		warnings: [warning, { path: '/domains/*/links/*/tags/1', message: 'Ignored dot-segment tag' }]
	};
	expect(await reload.onChange(next, initial)).toBe(true);
	expect(console.warn).toHaveBeenCalledTimes(2);
	expect(application.currentSnapshot().domains['go.example.test']?.links['/docs']?.url).toBe(
		'https://example.org/second'
	);
	await application.close?.();
});

test('stops visit writing if configuration monitoring cannot start', async () => {
	vi.mocked(startConfigReloading).mockRejectedValueOnce(new Error('Monitor startup failed'));
	await expect(createApplication(options)).rejects.toThrow('Monitor startup failed');
	expect(stopVisitWriter).toHaveBeenCalledOnce();
});

test('invalid startup fails before registering a monitor', async () => {
	vi.mocked(loadConfigFile).mockRejectedValue(new ConfigError());

	await expect(createApplication(options)).rejects.toThrow('Invalid configuration');
	expect(console.error).toHaveBeenCalledExactlyOnceWith('Invalid configuration');
	expect(startConfigReloading).not.toHaveBeenCalled();
	expect(createVisitWriter).not.toHaveBeenCalled();
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
	expect(createVisitWriter).not.toHaveBeenCalled();
});

test('does not expose arbitrary startup errors as configuration diagnostics', async () => {
	const failure = new Error('private connection detail');
	vi.mocked(loadConfigFile).mockRejectedValue(failure);

	await expect(createApplication(options)).rejects.toBe(failure);
	expect(console.error).not.toHaveBeenCalled();
});

function send(
	application: Awaited<ReturnType<typeof createApplication>>,
	path: string,
	method = 'GET',
	headers: IncomingMessage['headers'] = {}
) {
	return handleIngress(
		application,
		{
			headers: { host: 'go.example.test', ...headers },
			rawHeaders: ['Host', 'go.example.test'],
			url: path,
			method,
			socket: { remoteAddress: '127.0.0.1' }
		} as IncomingMessage,
		{}
	);
}

function withNewLink() {
	return prepared('https://example.org/second', {
		domains: {
			'go.example.test': {
				links: {
					'/docs': { url: 'https://example.org/second' },
					'/new': { url: 'https://example.org/new' }
				}
			}
		}
	});
}

test('waits for visit storage readiness before loading saved counts or starting the monitor', async () => {
	const ready = Promise.withResolvers<void>();
	const entered = Promise.withResolvers<void>();
	waitUntilReady.mockImplementationOnce(() => {
		entered.resolve();
		return ready.promise;
	});
	vi.mocked(readStoredLinkVisitCounts).mockResolvedValueOnce([
		{ domain: 'go.example.test', path: '/docs', visits: 12 }
	]);
	const starting = createApplication(options);
	await entered.promise;
	expect(readStoredLinkVisitCounts).not.toHaveBeenCalled();
	expect(startConfigReloading).not.toHaveBeenCalled();
	ready.resolve();
	const application = await starting;
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(12);
	expect(application.linkVisitCount('go.example.test', '/absent')).toBe(0);
	await application.close?.();
});

test('fails startup and stops visit writing when saved visit counts are unavailable', async () => {
	vi.mocked(readStoredLinkVisitCounts).mockRejectedValueOnce(
		new Error('Link visit counts unavailable')
	);
	await expect(createApplication(options)).rejects.toThrow('Link visit counts unavailable');
	expect(stopVisitWriter).toHaveBeenCalledOnce();
	expect(startConfigReloading).not.toHaveBeenCalled();
});

test('preserves live counts while loading saved counts for new links before publishing a reload', async () => {
	vi.mocked(readStoredLinkVisitCounts).mockResolvedValueOnce([
		{ domain: 'go.example.test', path: '/docs', visits: 5 }
	]);
	const application = await createApplication(options);
	const initial = application.currentSnapshot();
	const recovered =
		Promise.withResolvers<Array<{ domain: string; path: string; visits: number }>>();
	vi.mocked(readStoredLinkVisitCounts).mockReturnValueOnce(recovered.promise);
	const next = withNewLink();
	const applying = reload.onChange(next, prepared());
	expect(application.currentSnapshot()).toBe(initial);
	expect(readStoredLinkVisitCounts).toHaveBeenLastCalledWith('/deployment/data/goto.sqlite', [
		{ domain: 'go.example.test', path: '/new' }
	]);
	send(application, '/docs');
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(6);
	recovered.resolve([{ domain: 'go.example.test', path: '/new', visits: 9 }]);
	expect(await applying).toBe(true);
	expect(application.currentSnapshot().domains['go.example.test']?.links['/new']).toBeDefined();
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(6);
	expect(application.linkVisitCount('go.example.test', '/new')).toBe(9);

	const removed = prepared('https://example.org/third', { domains: {} });
	expect(await reload.onChange(removed, next)).toBe(true);
	expect(await reload.onChange(next, removed)).toBe(true);
	expect(readStoredLinkVisitCounts).toHaveBeenCalledTimes(2);
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(6);
	await application.close?.();
});

test('rejects the whole candidate when saved counts cannot load and accepts the corrected poll without losing counts', async () => {
	const application = await createApplication(options);
	const initial = application.currentSnapshot();
	const next = withNewLink();
	vi.mocked(readStoredLinkVisitCounts).mockRejectedValueOnce(new Error('private database detail'));
	expect(await reload.onChange(next, prepared())).toBe(false);
	expect(application.currentSnapshot()).toBe(initial);
	send(application, '/docs');
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(1);
	expect(console.warn).toHaveBeenCalledExactlyOnceWith(
		'Link visit counts unavailable; previous configuration remains active until a valid update is loaded'
	);
	expect(await reload.onChange(next, prepared())).toBe(true);
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(1);
	expect(application.linkVisitCount('go.example.test', '/new')).toBe(0);
	await application.close?.();
});

test('shutdown prevents a pending candidate from publishing', async () => {
	const application = await createApplication(options);
	const initial = application.currentSnapshot();
	const recovered =
		Promise.withResolvers<Array<{ domain: string; path: string; visits: number }>>();
	vi.mocked(readStoredLinkVisitCounts).mockReturnValueOnce(recovered.promise);
	const applying = reload.onChange(withNewLink(), prepared());
	await application.close?.();
	recovered.resolve([{ domain: 'go.example.test', path: '/new', visits: 8 }]);
	expect(await applying).toBe(false);
	expect(application.currentSnapshot()).toBe(initial);
	expect(await reload.onChange(withNewLink(), prepared())).toBe(false);
});

test('HEAD does not consume a visit, and the last allowed GET counts even if the writer rejects it', async () => {
	const domain = 'go.example.test';
	const path = '/docs';
	const destination = 'https://example.org/docs';
	const fallback = 'https://example.org/inactive';
	const initial = prepared(destination, {
		analytics: { retention_months: 0 },
		domains: {
			[domain]: {
				fallback: { url: fallback, status_code: 307 },
				links: { [path]: { url: destination, max_visits: 2 } }
			}
		}
	});
	vi.mocked(loadConfigFile).mockResolvedValueOnce(initial);
	vi.mocked(readStoredLinkVisitCounts).mockResolvedValueOnce([{ domain, path, visits: 1 }]);
	const application = await createApplication(options);

	expect(send(application, path, 'HEAD')?.headers.get('location')).toBe(destination);
	expect(application.linkVisitCount(domain, path)).toBe(1);
	expect(queueVisit).not.toHaveBeenCalled();

	let visitsAtAdmission: number | undefined;
	queueVisit.mockImplementationOnce(() => {
		visitsAtAdmission = application.linkVisitCount(domain, path);
		throw new Error('Rejected by bounded admission');
	});
	const lastAllowed = send(application, '/DOCS/');
	expect(lastAllowed?.status).toBe(302);
	expect(lastAllowed?.headers.get('location')).toBe(destination);
	expect(visitsAtAdmission).toBe(2);
	expect(queueVisit).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ domain, path, outcome: 'valid' })
	);

	const exhaustedHead = send(application, path, 'HEAD');
	expect(exhaustedHead?.status).toBe(307);
	expect(exhaustedHead?.headers.get('location')).toBe(fallback);
	expect(queueVisit).toHaveBeenCalledOnce();

	const exhausted = send(application, path);
	expect(exhausted?.status).toBe(307);
	expect(exhausted?.headers.get('location')).toBe(fallback);
	expect(queueVisit).toHaveBeenLastCalledWith(
		expect.objectContaining({ domain, path, outcome: 'invalid' })
	);
	expect(application.linkVisitCount(domain, path)).toBe(2);
	await application.close?.();
});

test('final redirect guards leave a limited link available until a valid GET succeeds', async () => {
	const initial = prepared('https://example.org/docs', {
		domains: {
			'go.example.test': {
				links: {
					'/docs': {
						url: 'https://example.org/docs',
						max_visits: 1,
						forward_path: true,
						redirect: [{ if: { language: 'fr' }, to: 'https://example.org/french' }]
					}
				}
			}
		}
	});
	initial.domains['go.example.test']!.links['/docs']!.redirect![0]!.to =
		'https://go.example.test/DOCS/again';
	vi.mocked(loadConfigFile).mockResolvedValueOnce(initial);
	const application = await createApplication(options);

	const blocked = send(application, '/docs/start', 'GET', { 'accept-language': 'fr' });
	expect(blocked?.status).toBe(404);
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(0);
	expect(queueVisit).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ path: '/docs', outcome: 'invalid' })
	);
	expect(send(application, '/docs')?.status).toBe(302);
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(1);
	expect(send(application, '/docs')?.status).toBe(404);
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(1);
	expect(queueVisit).toHaveBeenLastCalledWith(
		expect.objectContaining({ path: '/docs', outcome: 'invalid' })
	);
	await application.close?.();
});

test('raising, lowering, removing and restoring a limit preserves the live count without rereading storage', async () => {
	function configurationWithLimit(maxVisits: number | undefined) {
		return prepared('https://example.org/docs', {
			domains: {
				'go.example.test': {
					links: {
						'/docs': {
							url: 'https://example.org/docs',
							...(maxVisits === undefined ? {} : { max_visits: maxVisits })
						}
					}
				}
			}
		});
	}
	const initial = configurationWithLimit(2);
	vi.mocked(loadConfigFile).mockResolvedValueOnce(initial);
	vi.mocked(readStoredLinkVisitCounts).mockResolvedValueOnce([
		{ domain: 'go.example.test', path: '/docs', visits: 2 }
	]);
	const application = await createApplication(options);
	expect(send(application, '/docs')?.status).toBe(404);

	const raised = configurationWithLimit(3);
	expect(await reload.onChange(raised, initial)).toBe(true);
	expect(send(application, '/docs')?.status).toBe(302);
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(3);

	const lowered = configurationWithLimit(1);
	expect(await reload.onChange(lowered, raised)).toBe(true);
	expect(send(application, '/docs')?.status).toBe(404);
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(3);

	const unlimited = configurationWithLimit(undefined);
	expect(await reload.onChange(unlimited, lowered)).toBe(true);
	expect(send(application, '/docs')?.status).toBe(302);
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(4);

	const restored = configurationWithLimit(4);
	expect(await reload.onChange(restored, unlimited)).toBe(true);
	expect(send(application, '/docs')?.status).toBe(404);
	expect(application.linkVisitCount('go.example.test', '/docs')).toBe(4);
	expect(readStoredLinkVisitCounts).toHaveBeenCalledOnce();
	await application.close?.();
});
