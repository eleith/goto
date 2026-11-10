import type { VisitDetails } from '@goto/analytics';
import {
	availableVisitTimeframes,
	sumValidVisits,
	visitWindow,
	type VisitTimeframe,
	type VisitWindow
} from '@goto/analytics/daily';
import { readOverviewDetails } from '#lib/server/visit-reports.js';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals }) => {
	const snapshot = locals.snapshot;
	const configuration = snapshot.configuration;
	const retentionMonths = configuration.analytics.retention_months;
	const collectionEnabled = retentionMonths !== 0;
	const currentDomains = Object.keys(snapshot.domains);
	const report = collectionEnabled
		? await readOverviewDetails(configuration, currentDomains)
		: null;
	const timeframes = retentionMonths === 0 ? [] : availableVisitTimeframes(retentionMonths);
	const overview = report?.overview ?? null;
	const windows = overview
		? timeframes.map((timeframe) => ({
				timeframe,
				window: visitWindow(overview.period, timeframe)
			}))
		: [];
	const detailsByDomain = new Map(report?.domains.map(({ domain, details }) => [domain, details]));
	const domains = Object.entries(snapshot.domains).map(([domain, prepared]) => {
		const daily = detailsByDomain.get(domain)?.daily;
		const visitsByTimeframe = countVisitWindows(daily, windows);
		return {
			domain,
			linkCount: Object.keys(prepared.links).length,
			visitsByTimeframe,
			href: `/admin/domains/${encodeURIComponent(domain)}`
		};
	});
	const asOf = overview ? Date.parse(overview.period.asOf) : null;
	const visitsByTimeframe = countVisitWindows(overview?.daily, windows);
	const chart = overview ? { daily: overview.daily, period: overview.period } : null;
	return {
		collectionEnabled,
		available: overview !== null,
		retentionMonths,
		asOf,
		domainCount: domains.length,
		linkCount: domains.reduce((sum, row) => sum + row.linkCount, 0),
		timeframes,
		visitsByTimeframe,
		chart,
		domains
	};
}) satisfies PageServerLoad;

function countVisitWindows(
	daily: VisitDetails['daily'] | undefined,
	windows: Array<{ timeframe: VisitTimeframe; window: VisitWindow }>
): Partial<Record<VisitTimeframe, number>> {
	const counts: Partial<Record<VisitTimeframe, number>> = {};
	if (!daily) return counts;
	for (const { timeframe, window } of windows) {
		counts[timeframe] = sumValidVisits(daily, window);
	}
	return counts;
}
