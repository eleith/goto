import { error } from '@sveltejs/kit';
import { countBrowserOsVisitsByTimeframe } from '@goto/analytics';
import { availableVisitTimeframes, countVisitWindows, visitWindow } from '@goto/analytics/daily';
import { currentLinkState } from '#lib/server/link-state.js';
import { readVisitDetails } from '#lib/server/visit-reports.js';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals, params }) => {
	const snapshot = locals.snapshot;
	const domain = params.domain;
	if (!Object.hasOwn(snapshot.domains, domain)) throw error(404, 'Domain not configured');
	const prepared = snapshot.domains[domain]!;
	// Kit has decoded route parameters; preserve literal percent paths as-is.
	const path = `/${params.path ?? ''}`;
	if (!Object.hasOwn(prepared.links, path)) throw error(404, 'Link not configured');
	const link = prepared.links[path]!;
	const response = {
		url: link.url,
		status_code: link.status_code,
		forward_query: link.forward_query
	};
	const state = currentLinkState(link, Date.now());
	const validFrom = link.valid_from ?? null;
	const validUntil = link.valid_until ?? null;
	const configuration = snapshot.configuration;
	const retentionMonths = configuration.analytics.retention_months;
	const collectionEnabled = retentionMonths !== 0;
	const scope = { kind: 'link' as const, domain, path };
	const details = collectionEnabled ? await readVisitDetails(configuration, scope) : null;
	const timeframes = retentionMonths === 0 ? [] : availableVisitTimeframes(retentionMonths);
	const windows = details
		? timeframes.map((timeframe) => ({ timeframe, window: visitWindow(details.period, timeframe) }))
		: [];
	const countsByTimeframe = countVisitWindows(details?.daily, windows);
	const browserOsVisitsByTimeframe = countBrowserOsVisitsByTimeframe(details ?? undefined, windows);
	const asOf = details ? Date.parse(details.period.asOf) : null;
	const chart = details ? { daily: details.daily, period: details.period } : null;

	return {
		domain,
		path,
		response,
		caseInsensitive: link.case_insensitive,
		ignoreTrailingSlash: link.ignore_trailing_slash,
		forwardPath: link.forward_path,
		state,
		validFrom,
		validUntil,
		tags: link.tags,
		retentionMonths,
		collectionEnabled,
		available: details !== null,
		asOf,
		timeframes,
		countsByTimeframe,
		browserOsVisitsByTimeframe,
		chart
	};
}) satisfies PageServerLoad;
