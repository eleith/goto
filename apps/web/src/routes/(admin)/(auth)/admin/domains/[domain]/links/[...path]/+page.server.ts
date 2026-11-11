import { error } from '@sveltejs/kit';
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
	if (path !== '/' && !Object.hasOwn(prepared.links, path)) throw error(404, 'Link not configured');
	const link = prepared.links[path];
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
	const state = link ? currentLinkState(link, Date.now()) : 'Fallback';
	const asOf = details ? Date.parse(details.period.asOf) : null;
	const chart = details ? { daily: details.daily, period: details.period } : null;

	return {
		domain,
		path,
		domainHref: `/admin/domains/${encodeURIComponent(domain)}`,
		url: link?.url ?? null,
		fallback: prepared.fallback,
		state,
		retentionMonths,
		collectionEnabled,
		available: details !== null,
		asOf,
		timeframes,
		countsByTimeframe,
		chart
	};
}) satisfies PageServerLoad;
