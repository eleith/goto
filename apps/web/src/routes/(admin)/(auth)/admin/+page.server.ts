import { readVisitReport } from '#lib/server/visit-reports.js';
import type { StoredVisitReports } from '@goto/db/visit-reports';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const snapshot = locals.snapshot;
	const configuration = snapshot.configuration;
	const retentionMonths = configuration.analytics.retention_months;
	const collectionEnabled = retentionMonths !== 0;
	let preparedReports: StoredVisitReports | null = null;
	if (collectionEnabled) preparedReports = await readVisitReport(configuration);
	const report = preparedReports?.report;

	const domains = Object.entries(snapshot.domains).map(([domain, prepared]) => ({
		domain,
		linkCount: Object.keys(prepared.links).length,
		counts: report?.domainCounts.find((row) => row.domain === domain)?.counts ?? null,
		href: `/admin/domains/${encodeURIComponent(domain)}`
	}));
	return {
		collectionEnabled,
		available: preparedReports !== null,
		retentionMonths,
		since: preparedReports?.period.since ?? null,
		asOf: preparedReports?.period.asOf ?? null,
		domainCount: domains.length,
		linkCount: domains.reduce((sum, row) => sum + row.linkCount, 0),
		totals: report?.totals ?? null,
		domains
	};
};
