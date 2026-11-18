import { error } from '@sveltejs/kit';
import { countBreakdownVisitsByTimeframe } from '@goto/analytics';
import { availableVisitTimeframes, countVisitWindows, visitWindow } from '@goto/analytics/daily';
import { linkHref } from '#lib/components/admin/urls.js';
import { currentLinkState } from '#lib/server/link-state.js';
import { readDomainDetails } from '#lib/server/visits/reports.js';
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
	const browserVisitsByTimeframe = countBreakdownVisitsByTimeframe(
		domainDetails?.browsers,
		windows
	);
	const operatingSystemVisitsByTimeframe = countBreakdownVisitsByTimeframe(
		domainDetails?.operatingSystems,
		windows
	);
	const acceptedLanguageVisitsByTimeframe = countBreakdownVisitsByTimeframe(
		domainDetails?.acceptedLanguages,
		windows
	);
	let rootUrl: string | null = null;
	if (prepared.root !== null) rootUrl = prepared.root.url;
	else if (prepared.fallback !== null) rootUrl = prepared.fallback.url;
	const rootCountsByTimeframe = countVisitWindows(detailsByPath.get('/')?.daily, windows);
	const rootHref = linkHref(domain, '/');
	const now = Date.now();
	const links = [
		{
			path: '/',
			url: rootUrl,
			state: 'active' as const,
			countsByTimeframe: rootCountsByTimeframe,
			href: rootHref
		},
		...Object.entries(prepared.links).map(([path, link]) => {
			const daily = detailsByPath.get(path)?.daily;
			const countsByTimeframe = countVisitWindows(daily, windows);
			return {
				path,
				url: link.url,
				state: currentLinkState(link, now),
				countsByTimeframe,
				href: linkHref(domain, path)
			};
		})
	];
	const lastActivityAt = domainDetails?.lastActivityAt
		? Date.parse(domainDetails.lastActivityAt)
		: null;
	const chart = domainDetails ? { daily: domainDetails.daily, period: domainDetails.period } : null;
	return {
		domain,
		retentionMonths,
		collectionEnabled,
		available: domainDetails !== null,
		lastActivityAt,
		linkCount: currentPaths.length,
		timeframes,
		countsByTimeframe,
		browserVisitsByTimeframe,
		operatingSystemVisitsByTimeframe,
		acceptedLanguageVisitsByTimeframe,
		chart,
		root: prepared.root,
		fallback: prepared.fallback,
		links
	};
}) satisfies PageServerLoad;
