import packageJson from '../../../../../../package.json' with { type: 'json' };
import { loadConfig } from '@goto/config';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readLastActivity } from '#lib/server/visits/reports.js';
import { isWorkerReachable } from '#lib/server/worker-health.js';
import { actions, load } from './+page.server.js';

vi.mock('#lib/server/visits/reports.js', () => ({ readLastActivity: vi.fn() }));
vi.mock('#lib/server/worker-health.js', () => ({ isWorkerReachable: vi.fn() }));
beforeEach(() => {
	vi.resetAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-06-15T13:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

function request(overrides: Record<string, unknown> = {}) {
	const configuration = loadConfig(
		{
			url: { app: 'https://admin.example.test', worker: 'http://worker.example.test:9000/base' },
			auth: {
				secret: 'health-test-auth-secret-not-for-page-data',
				credentials: { username: 'health-admin', password: 'private-health-password' }
			},
			database: { path: './private-visits.sqlite', worker_path: './private-worker.sqlite' },
			domains: {},
			...overrides
		},
		{ env: {} }
	);
	return {
		locals: { snapshot: prepareSnapshot(configuration) },
		request: new Request('https://admin.example.test/admin/health?/checkWorker', {
			method: 'POST',
			body: new URLSearchParams({ workerUrl: 'https://untrusted.example.test/forged' })
		})
	} as Parameters<typeof load>[0];
}

test('returns only allowlisted settings and actual last data activity, without probing', async () => {
	const lastActivityAt = '2026-06-01T12:34:56.000Z';
	vi.mocked(readLastActivity).mockResolvedValue({ available: true, lastActivityAt });
	const event = request();
	const data = await load(event);

	expect(data).toEqual({
		appVersion: packageJson.version,
		appUrl: 'https://admin.example.test',
		authMode: 'credentials',
		retentionMonths: 3,
		lastDataActivity: lastActivityAt,
		activityAvailable: true,
		redirectStatusCode: 302,
		forwardQuery: false,
		caseInsensitive: true,
		ignoreTrailingSlash: true,
		forwardPath: false,
		fallbackDestination: 404,
		workerUrl: 'http://worker.example.test:9000/base',
		tags: []
	});
	expect(readLastActivity).toHaveBeenCalledExactlyOnceWith(event.locals.snapshot.configuration);
	expect(isWorkerReachable).not.toHaveBeenCalled();
});

test('projects OIDC mode and configured redirect defaults without exposing the provider settings', async () => {
	vi.mocked(readLastActivity).mockResolvedValue({ available: true, lastActivityAt: null });
	const data = await load(
		request({
			auth: {
				secret: 'health-test-auth-secret-not-for-page-data',
				oidc: {
					issuer: 'https://identity.example.test',
					client_id: 'private-client-id',
					client_secret: 'private-client-secret'
				}
			},
			link_defaults: {
				status_code: 307,
				forward_query: true,
				case_insensitive: false,
				ignore_trailing_slash: false,
				forward_path: true
			},
			fallback: { url: 'https://example.test/missing' }
		})
	);

	expect(data).toEqual({
		appVersion: packageJson.version,
		appUrl: 'https://admin.example.test',
		authMode: 'oidc',
		retentionMonths: 3,
		lastDataActivity: null,
		activityAvailable: true,
		redirectStatusCode: 307,
		forwardQuery: true,
		caseInsensitive: false,
		ignoreTrailingSlash: false,
		forwardPath: true,
		fallbackDestination: 'https://example.test/missing',
		workerUrl: 'http://worker.example.test:9000/base',
		tags: []
	});
});

test('zero retention skips the activity read but still lists tags', async () => {
	const data = await load(
		request({
			analytics: { retention_months: 0 },
			domains: {
				'go.example.test': {
					links: { '/docs': { url: 'https://example.test/docs', tags: ['Work/100%é'] } }
				}
			}
		})
	);
	expect(data.tags).toEqual(['Work/100%é']);
	expect(data.retentionMonths).toBe(0);
	expect(data.lastDataActivity).toBeNull();
	expect(data.activityAvailable).toBe(true);
	expect(data.appUrl).toBe('https://admin.example.test');
	expect(readLastActivity).not.toHaveBeenCalled();
	expect(isWorkerReachable).not.toHaveBeenCalled();
});

test('unavailable analytics storage does not prevent viewing settings', async () => {
	vi.mocked(readLastActivity).mockResolvedValue({ available: false, lastActivityAt: null });
	const data = await load(request());
	expect(data.retentionMonths).toBe(3);
	expect(data.lastDataActivity).toBeNull();
	expect(data.activityAvailable).toBe(false);
	expect(data.workerUrl).toBe('http://worker.example.test:9000/base');
	expect(isWorkerReachable).not.toHaveBeenCalled();
});

test('manual worker check uses the current configured address, ignoring submitted targets', async () => {
	vi.mocked(readLastActivity).mockResolvedValue({ available: true, lastActivityAt: null });
	await load(request());
	const event = request({
		url: { app: 'https://admin.example.test', worker: 'http://current-worker.example.test:9001' }
	}) as Parameters<typeof actions.checkWorker>[0];
	vi.mocked(isWorkerReachable).mockResolvedValue(true);
	const before = Date.now();
	const result = await actions.checkWorker(event);

	expect(isWorkerReachable).toHaveBeenCalledExactlyOnceWith(
		'http://current-worker.example.test:9001'
	);
	expect(result).toEqual({ workerCheck: { reachable: true, checkedAt: expect.any(String) } });
	expect(new Date(result.workerCheck.checkedAt).toISOString()).toBe(result.workerCheck.checkedAt);
	expect(Date.parse(result.workerCheck.checkedAt)).toBeGreaterThanOrEqual(before);
	expect(Date.parse(result.workerCheck.checkedAt)).toBeLessThanOrEqual(Date.now());
});

test('an unreachable worker returns only the negative result and completion timestamp', async () => {
	vi.mocked(isWorkerReachable).mockResolvedValue(false);
	const result = await actions.checkWorker(request() as Parameters<typeof actions.checkWorker>[0]);
	expect(result).toEqual({ workerCheck: { reachable: false, checkedAt: expect.any(String) } });
	expect(new Date(result.workerCheck.checkedAt).toISOString()).toBe(result.workerCheck.checkedAt);
	expect(readLastActivity).not.toHaveBeenCalled();
});
