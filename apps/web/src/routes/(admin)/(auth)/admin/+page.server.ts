import { readVisitSummary } from '#lib/server/visit-reports.js';
import type { OverviewSummary } from '@goto/analytics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const snapshot = locals.snapshot;
	const configuration = snapshot.configuration;
	const retentionMonths = configuration.analytics.retention_months;
	const collectionEnabled = retentionMonths !== 0;
	let overview: OverviewSummary | null = null;
	if (collectionEnabled) {
		const summary = await readVisitSummary(configuration, { kind: 'overview' });
		if (summary && 'domains' in summary) overview = summary;
	}
	const countsByDomain = new Map(overview?.domains.map((row) => [row.domain, row.totals]));
	const domains = Object.entries(snapshot.domains).map(([domain, prepared]) => ({
		domain,
		linkCount: Object.keys(prepared.links).length,
		counts: countsByDomain.get(domain) ?? null,
		href: `/admin/domains/${encodeURIComponent(domain)}`
	}));
	const asOf = overview ? Date.parse(overview.period.asOf) : null;
	return {
		collectionEnabled,
		available: overview !== null,
		retentionMonths,
		asOf,
		domainCount: domains.length,
		linkCount: domains.reduce((sum, row) => sum + row.linkCount, 0),
		totals: overview?.totals ?? null,
		domains
	};
};
