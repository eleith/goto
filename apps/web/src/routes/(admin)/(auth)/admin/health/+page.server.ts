import packageJson from '../../../../../../package.json' with { type: 'json' };
import { readOverviewDetails } from '#lib/server/visit-reports.js';
import { isWorkerReachable } from '#lib/server/worker-health.js';
import type { Actions, PageServerLoad } from './$types';

const MAX_REPORT_AGE_MS = 75 * 60 * 1000;

export const load = (async ({ locals }) => {
	const configuration = locals.snapshot.configuration;
	const retentionMonths = configuration.analytics.retention_months;
	const report = retentionMonths === 0 ? null : await readOverviewDetails(configuration, []);
	const reportDataAsOf = report?.overview.period.asOf ?? null;
	const reportDelayed =
		reportDataAsOf !== null && Date.now() - Date.parse(reportDataAsOf) > MAX_REPORT_AGE_MS;
	const authMode = configuration.auth.oidc ? ('oidc' as const) : ('credentials' as const);

	return {
		appVersion: packageJson.version,
		appUrl: configuration.url.app,
		authMode,
		retentionMonths,
		reportDataAsOf,
		reportDelayed,
		redirectStatusCode: configuration.link_defaults.status_code,
		forwardQuery: configuration.link_defaults.forward_query,
		fallbackDestination: configuration.fallback?.url ?? 404,
		workerUrl: configuration.url.worker
	};
}) satisfies PageServerLoad;

export const actions = {
	checkWorker: async ({ locals }) => {
		const reachable = await isWorkerReachable(locals.snapshot.configuration.url.worker);
		return { workerCheck: { reachable, checkedAt: new Date().toISOString() } };
	}
} satisfies Actions;
