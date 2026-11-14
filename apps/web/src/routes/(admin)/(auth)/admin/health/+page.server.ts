import packageJson from '../../../../../../package.json' with { type: 'json' };
import { readOverviewDetails } from '#lib/server/visits/reports.js';
import { currentTags } from '#lib/server/tags/inventory.js';
import { isWorkerReachable } from '#lib/server/worker-health.js';
import type { Actions, PageServerLoad } from './$types';

const MAX_REPORT_AGE_MS = 75 * 60 * 1000;

export const load = (async ({ locals }) => {
	const snapshot = locals.snapshot;
	const configuration = snapshot.configuration;
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
		caseInsensitive: configuration.link_defaults.case_insensitive,
		ignoreTrailingSlash: configuration.link_defaults.ignore_trailing_slash,
		forwardPath: configuration.link_defaults.forward_path,
		fallbackDestination: configuration.fallback?.url ?? 404,
		workerUrl: configuration.url.worker,
		tags: currentTags(snapshot.domains)
	};
}) satisfies PageServerLoad;

export const actions = {
	checkWorker: async ({ locals }) => {
		const reachable = await isWorkerReachable(locals.snapshot.configuration.url.worker);
		return { workerCheck: { reachable, checkedAt: new Date().toISOString() } };
	}
} satisfies Actions;
