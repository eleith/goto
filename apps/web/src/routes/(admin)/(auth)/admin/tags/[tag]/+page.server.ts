import { error } from '@sveltejs/kit';
import {
	countAcceptedLanguageVisitsByTimeframe,
	countBrowserOsVisitsByTimeframe,
	type VisitDetails
} from '@goto/analytics';
import { availableVisitTimeframes, countVisitWindows, visitWindow } from '@goto/analytics/daily';
import { linkHref } from '#lib/components/admin/urls.js';
import { currentLinkState } from '#lib/server/link-state.js';
import { tagMembers } from '#lib/server/tags/inventory.js';
import { combineTagVisits } from '#lib/server/tags/visits.js';
import { readLinkDetails } from '#lib/server/visits/reports.js';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals, params }) => {
	const snapshot = locals.snapshot;
	const tag = params.tag;
	const members = tagMembers(snapshot.domains, tag);
	if (members.length === 0) throw error(404, 'Tag not configured');
	const now = Date.now();
	const configuration = snapshot.configuration;
	const retentionMonths = configuration.analytics.retention_months;
	const collectionEnabled = retentionMonths !== 0;
	const identities = members.map(({ domain, path }) => ({ domain, path }));
	const report = collectionEnabled ? await readLinkDetails(configuration, identities) : null;
	const tagDetails = report ? combineTagVisits(report) : null;
	const timeframes = retentionMonths === 0 ? [] : availableVisitTimeframes(retentionMonths);
	const windows = tagDetails
		? timeframes.map((timeframe) => ({
				timeframe,
				window: visitWindow(tagDetails.period, timeframe)
			}))
		: [];
	const countsByTimeframe = countVisitWindows(tagDetails?.daily, windows);
	const acceptedLanguageVisitsByTimeframe = countAcceptedLanguageVisitsByTimeframe(
		tagDetails ?? undefined,
		windows
	);
	const browserOsVisitsByTimeframe = countBrowserOsVisitsByTimeframe(
		tagDetails ?? undefined,
		windows
	);
	const detailsByDomain = new Map<string, Map<string, VisitDetails>>();
	for (const { domain, path, details } of report?.links ?? []) {
		let domainDetails = detailsByDomain.get(domain);
		if (!domainDetails) {
			domainDetails = new Map();
			detailsByDomain.set(domain, domainDetails);
		}
		domainDetails.set(path, details);
	}
	const links = members.map(({ domain, path, link }) => {
		const daily = detailsByDomain.get(domain)?.get(path)?.daily;
		const countsByTimeframe = countVisitWindows(daily, windows);
		return {
			domain,
			path,
			state: currentLinkState(link, now),
			countsByTimeframe,
			href: linkHref(domain, path)
		};
	});
	const asOf = tagDetails ? Date.parse(tagDetails.period.asOf) : null;
	const chart = tagDetails ? { daily: tagDetails.daily, period: tagDetails.period } : null;
	return {
		tag,
		retentionMonths,
		collectionEnabled,
		available: tagDetails !== null,
		asOf,
		linkCount: members.length,
		timeframes,
		countsByTimeframe,
		acceptedLanguageVisitsByTimeframe,
		browserOsVisitsByTimeframe,
		chart,
		links
	};
}) satisfies PageServerLoad;
