import { error } from '@sveltejs/kit';
import { countBreakdownVisitsByTimeframe } from '@goto/analytics';
import { availableVisitTimeframes, countVisitWindows, visitWindow } from '@goto/analytics/daily';
import { currentLinkState } from '#lib/server/link-state.js';
import { readVisitDetails } from '#lib/server/visits/reports.js';
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
	const lifetimeVisits = locals.application.linkVisitCount(domain, path);
	const response = {
		url: link.url,
		status_code: link.status_code,
		forward_query: link.forward_query
	};
	const redirectRules = (link.redirect ?? []).map((rule) => ({
		language: rule.if.language ?? null,
		os: rule.if.os ?? null,
		to: rule.to
	}));
	const state = currentLinkState(link, Date.now());
	const validFrom = link.valid_from ?? null;
	const validUntil = link.valid_until ?? null;
	const configuration = snapshot.configuration;
	const retentionMonths = configuration.analytics.retention_months;
	const collectionEnabled = retentionMonths !== 0;
	const scope = { kind: 'link' as const, domain, path };
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
		path,
		lifetimeVisits,
		response,
		redirectRules,
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
		lastActivityAt,
		timeframes,
		countsByTimeframe,
		browserVisitsByTimeframe,
		operatingSystemVisitsByTimeframe,
		acceptedLanguageVisitsByTimeframe,
		chart
	};
}) satisfies PageServerLoad;
