import { error } from '@sveltejs/kit';
import { countBreakdownVisitsByTimeframe } from '@goto/analytics';
import { availableVisitTimeframes, countVisitWindows, visitWindow } from '@goto/analytics/daily';
import { readVisitDetails } from '#lib/server/visits/reports.js';
import { readLifetimeVisitTotals } from '#lib/server/visits/totals.js';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals, params }) => {
	const snapshot = locals.snapshot;
	const domain = params.domain;
	if (!Object.hasOwn(snapshot.domains, domain)) throw error(404, 'Domain not configured');
	const prepared = snapshot.domains[domain]!;
	const response = prepared.root;
	const fallback = prepared.fallback;
	const configuration = snapshot.configuration;
	const retentionMonths = configuration.analytics.retention_months;
	const collectionEnabled = retentionMonths !== 0;
	const scope = { kind: 'link' as const, domain, path: '/' };
	const lifetimeVisitTotals = await readLifetimeVisitTotals(configuration, scope);
	let details: Awaited<ReturnType<typeof readVisitDetails>> = null;
	if (collectionEnabled) {
		details = await readVisitDetails(configuration, scope);
	}
	const timeframes = retentionMonths === 0 ? [] : availableVisitTimeframes(retentionMonths);
	const windows = details
		? timeframes.map((timeframe) => ({ timeframe, window: visitWindow(details.period, timeframe) }))
		: [];
	const countsByTimeframe = countVisitWindows(details?.daily, windows);
	const browserVisitsByTimeframe = countBreakdownVisitsByTimeframe(details?.browsers, windows);
	const operatingSystemVisitsByTimeframe = countBreakdownVisitsByTimeframe(
		details?.operatingSystems,
		windows
	);
	const acceptedLanguageVisitsByTimeframe = countBreakdownVisitsByTimeframe(
		details?.acceptedLanguages,
		windows
	);
	const lastActivityAt = details?.lastActivityAt ? Date.parse(details.lastActivityAt) : null;
	const chart = details ? { daily: details.daily, period: details.period } : null;

	return {
		domain,
		lifetimeVisitTotals,
		domainHref: `/admin/domains/${encodeURIComponent(domain)}`,
		response,
		fallback,
		fallbackSource: prepared.provenance.fallback,
		retentionMonths,
		collectionEnabled,
		available: details !== null,
		lastActivityAt,
		timeframes,
		countsByTimeframe,
		browserVisitsByTimeframe,
		operatingSystemVisitsByTimeframe,
		acceptedLanguageVisitsByTimeframe,
		chart
	};
}) satisfies PageServerLoad;
