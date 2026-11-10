import { error } from '@sveltejs/kit';
import {
	availableVisitTimeframes,
	countVisitWindows,
	visitWindow,
	type VisitTimeframe
} from '@goto/analytics/daily';
import { currentLinkState } from '#lib/server/link-state.js';
import { readDomainDetails } from '#lib/server/visit-reports.js';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals, params }) => {
	const snapshot = locals.snapshot;
	const domain = params.domain;
	if (!Object.hasOwn(snapshot.domains, domain)) throw error(404, 'Domain not configured');
	const prepared = snapshot.domains[domain]!;
	const configuration = snapshot.configuration;
	const retentionMonths = configuration.analytics.retention_months;
	const collectionEnabled = retentionMonths !== 0;
	const currentPaths = Object.keys(prepared.links);
	const report = collectionEnabled
		? await readDomainDetails(configuration, domain, currentPaths)
		: null;
	const domainDetails = report?.domain ?? null;
	const timeframes = retentionMonths === 0 ? [] : availableVisitTimeframes(retentionMonths);
	const windows = domainDetails
		? timeframes.map((timeframe) => ({
				timeframe,
				window: visitWindow(domainDetails.period, timeframe)
			}))
		: [];
	const detailsByPath = new Map(report?.links.map(({ path, details }) => [path, details]));
	const countsByTimeframe = countVisitWindows(domainDetails?.daily, windows);
	const baseCountsByTimeframe = countVisitWindows(detailsByPath.get('/')?.daily, windows);
	const invalidClicksByTimeframe: Partial<Record<VisitTimeframe, number>> = {};
	for (const { timeframe } of windows) {
		const totals = countsByTimeframe[timeframe];
		if (!totals) continue;
		const base = baseCountsByTimeframe[timeframe];
		if (!base) continue;
		invalidClicksByTimeframe[timeframe] = totals.invalidVisits - base.invalidVisits;
	}

	const now = Date.now();
	const links = Object.entries(prepared.links).map(([path, link]) => {
		const daily = detailsByPath.get(path)?.daily;
		const countsByTimeframe = countVisitWindows(daily, windows);
		return {
			path,
			url: link.url,
			state: currentLinkState(link, now),
			countsByTimeframe,
			href: linkHref(domain, path)
		};
	});
	const root = prepared.links['/'];
	let baseUrl = prepared.fallback === 404 ? null : prepared.fallback;
	let baseState = 'Fallback';
	if (root && currentLinkState(root, now) === 'Active') {
		baseUrl = root.url;
		baseState = 'Active';
	}
	const asOf = domainDetails ? Date.parse(domainDetails.period.asOf) : null;
	const chart = domainDetails ? { daily: domainDetails.daily, period: domainDetails.period } : null;
	return {
		domain,
		retentionMonths,
		collectionEnabled,
		available: domainDetails !== null,
		asOf,
		linkCount: links.length,
		timeframes,
		countsByTimeframe,
		invalidClicksByTimeframe,
		chart,
		base: {
			url: baseUrl,
			state: baseState,
			countsByTimeframe: baseCountsByTimeframe,
			href: linkHref(domain, '/')
		},
		links
	};
}) satisfies PageServerLoad;

function linkHref(domain: string, path: string): string {
	const base = `/admin/domains/${encodeURIComponent(domain)}/links`;
	if (path === '/') return base;
	const segments = path.slice(1).split('/').map(encodeURIComponent);
	return `${base}/${segments.join('/')}`;
}
