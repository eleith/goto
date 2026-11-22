import { readLastActivity } from '#lib/server/visits/reports.js';
import { readOverviewLifetimeVisitTotals } from '#lib/server/visits/totals.js';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals }) => {
	const { configuration, domains: configuredDomains } = locals.snapshot;
	const analyticsEnabled = configuration.analytics.retention_months !== 0;
	const totals = await readOverviewLifetimeVisitTotals(
		configuration,
		Object.keys(configuredDomains)
	);
	const activity = analyticsEnabled ? await readLastActivity(configuration) : null;
	const domains = Object.entries(configuredDomains).map(([domain, prepared]) => ({
		domain,
		linkCount: Object.keys(prepared.links).length,
		totalVisits: totals?.byDomain.get(domain)?.validVisits ?? null,
		href: `/admin/domains/${encodeURIComponent(domain)}`
	}));

	return {
		analyticsEnabled,
		lastActivityAt: activity?.lastActivityAt ? Date.parse(activity.lastActivityAt) : null,
		domainCount: domains.length,
		linkCount: domains.reduce((sum, row) => sum + row.linkCount, 0),
		totalVisits: totals?.overview.validVisits ?? null,
		domains
	};
}) satisfies PageServerLoad;
