import packageJson from '../../../../../../package.json' with { type: 'json' };
import { createVisitPeriod, visitDays, type VisitDetails } from '@goto/analytics';
import { validateConfig } from '@goto/config';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readOverviewDetails } from '#lib/server/visit-reports.js';
import { isWorkerReachable } from '#lib/server/worker-health.js';
import { actions, load } from './+page.server.js';

vi.mock('#lib/server/visit-reports.js', () => ({ readOverviewDetails: vi.fn() }));
vi.mock('#lib/server/worker-health.js', () => ({ isWorkerReachable: vi.fn() }));
beforeEach(() => {
	vi.resetAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-06-15T13:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

function request(overrides: Record<string, unknown> = {}) {
	const configuration = validateConfig(
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

function emptyOverview(): VisitDetails {
	const period = createVisitPeriod(3, Date.parse('2026-06-15T12:34:56.000Z'));
	return {
		version: 3,
		scope: { kind: 'overview' },
		period,
		daily: visitDays(period).map((day) => ({ ...day, validVisits: 0, invalidVisits: 0 })),
		browsers: [],
		operatingSystems: []
	};
}

test('returns only allowlisted settings and the prepared report cutoff, without probing', async () => {
	const overview = emptyOverview();
	vi.mocked(readOverviewDetails).mockResolvedValue({ overview, domains: [] });
	const event = request();
	const data = await load(event);

	expect(data).toEqual({
		appVersion: packageJson.version,
		appUrl: 'https://admin.example.test',
		authMode: 'credentials',
		retentionMonths: 3,
		reportDataAsOf: overview.period.asOf,
		reportDelayed: false,
		redirectStatusCode: 302,
		forwardQuery: false,
		fallbackDestination: 404,
		workerUrl: 'http://worker.example.test:9000/base'
	});
	expect(readOverviewDetails).toHaveBeenCalledExactlyOnceWith(
		event.locals.snapshot.configuration,
		[]
	);
	expect(isWorkerReachable).not.toHaveBeenCalled();
});

test('projects OIDC mode and configured redirect defaults without exposing the provider settings', async () => {
	vi.mocked(readOverviewDetails).mockResolvedValue(null);
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
			link_defaults: { status_code: 307, forward_query: true },
			fallback: { url: 'https://example.test/missing' }
		})
	);

	expect(data).toEqual({
		appVersion: packageJson.version,
		appUrl: 'https://admin.example.test',
		authMode: 'oidc',
		retentionMonths: 3,
		reportDataAsOf: null,
		reportDelayed: false,
		redirectStatusCode: 307,
		forwardQuery: true,
		fallbackDestination: 'https://example.test/missing',
		workerUrl: 'http://worker.example.test:9000/base'
	});
});

test('marks reports delayed only after the hourly refresh grace period', async () => {
	const overview = emptyOverview();
	vi.mocked(readOverviewDetails).mockResolvedValue({ overview, domains: [] });
	const graceDeadline = Date.parse(overview.period.asOf) + 75 * 60 * 1000;
	vi.setSystemTime(new Date(graceDeadline));
	expect((await load(request())).reportDelayed).toBe(false);
	vi.setSystemTime(new Date(graceDeadline + 1));
	expect((await load(request())).reportDelayed).toBe(true);
});

test('zero retention skips the report read and remains a normal read-only page', async () => {
	const data = await load(request({ analytics: { retention_months: 0 } }));
	expect(data.retentionMonths).toBe(0);
	expect(data.reportDataAsOf).toBeNull();
	expect(data.reportDelayed).toBe(false);
	expect(data.appUrl).toBe('https://admin.example.test');
	expect(readOverviewDetails).not.toHaveBeenCalled();
	expect(isWorkerReachable).not.toHaveBeenCalled();
});

test('unavailable prepared analytics do not prevent viewing settings', async () => {
	vi.mocked(readOverviewDetails).mockResolvedValue(null);
	const data = await load(request());
	expect(data.retentionMonths).toBe(3);
	expect(data.reportDataAsOf).toBeNull();
	expect(data.reportDelayed).toBe(false);
	expect(data.workerUrl).toBe('http://worker.example.test:9000/base');
	expect(isWorkerReachable).not.toHaveBeenCalled();
});

test('manual worker check uses the current configured address, ignoring submitted targets', async () => {
	vi.mocked(readOverviewDetails).mockResolvedValue(null);
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
	expect(readOverviewDetails).not.toHaveBeenCalled();
});
