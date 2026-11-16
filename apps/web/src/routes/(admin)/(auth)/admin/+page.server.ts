import { countBreakdownVisitsByTimeframe } from '@goto/analytics';
import { availableVisitTimeframes, countVisitWindows, visitWindow } from '@goto/analytics/daily';
import { readOverviewDetails } from '#lib/server/visits/reports.js';
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
		const countsByTimeframe = countVisitWindows(daily, windows);
		return {
			domain,
			linkCount: Object.keys(prepared.links).length,
			countsByTimeframe,
			href: `/admin/domains/${encodeURIComponent(domain)}`
		};
	});
	const browserVisitsByTimeframe = countBreakdownVisitsByTimeframe(overview?.browsers, windows);
	const operatingSystemVisitsByTimeframe = countBreakdownVisitsByTimeframe(
		overview?.operatingSystems,
		windows
	);
	const acceptedLanguageVisitsByTimeframe = countBreakdownVisitsByTimeframe(
		overview?.acceptedLanguages,
		windows
	);
	const asOf = overview ? Date.parse(overview.period.asOf) : null;
	const countsByTimeframe = countVisitWindows(overview?.daily, windows);
	const chart = overview ? { daily: overview.daily, period: overview.period } : null;
	return {
		collectionEnabled,
		available: overview !== null,
		retentionMonths,
		asOf,
		domainCount: domains.length,
		linkCount: domains.reduce((sum, row) => sum + row.linkCount, 0),
		timeframes,
		countsByTimeframe,
		browserVisitsByTimeframe,
		operatingSystemVisitsByTimeframe,
		acceptedLanguageVisitsByTimeframe,
		chart,
		domains
	};
}) satisfies PageServerLoad;
