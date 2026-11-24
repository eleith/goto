import { error } from '@sveltejs/kit';
import { linkHref } from '#lib/components/admin/urls.js';
import { currentLinkState } from '#lib/server/link-state.js';
import { readLastActivity } from '#lib/server/visits/reports.js';
import { readDomainLifetimeVisitTotals } from '#lib/server/visits/totals.js';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals, params }) => {
	const { configuration, domains } = locals.snapshot;
	const domain = params.domain;
	if (!Object.hasOwn(domains, domain)) error(404, 'Domain not configured');

	const prepared = domains[domain]!;
	const namedLinks = Object.entries(prepared.links);
	const analyticsEnabled = configuration.analytics.retention_months !== 0;
	const totals = await readDomainLifetimeVisitTotals(
		configuration,
		domain,
		Object.keys(prepared.links)
	);
	const activity = analyticsEnabled
		? await readLastActivity(configuration, { kind: 'domain', domain })
		: null;
	const now = Date.now();
	const links = [
		{
			path: '/',
			url: prepared.root?.url ?? prepared.fallback?.url ?? null,
			state: 'active' as const,
			visits: totals?.byPath.get('/')?.validVisits ?? null,
			href: linkHref(domain, '/')
		},
		...namedLinks.map(([path, link]) => ({
			path,
			url: link.url,
			state: currentLinkState(link, now, locals.application.linkVisitCount(domain, path)),
			visits: totals?.byPath.get(path)?.validVisits ?? null,
			href: linkHref(domain, path)
		}))
	];

	return {
		domain,
		analyticsEnabled,
		lastActivityAt: activity?.lastActivityAt ? Date.parse(activity.lastActivityAt) : null,
		linkCount: namedLinks.length,
		totalVisits: totals?.domain.validVisits ?? null,
		invalidClicks: totals?.domain.invalidVisits ?? null,
		rootVisits: totals?.domain.rootVisits ?? null,
		root: prepared.root,
		fallback: prepared.fallback,
		links
	};
}) satisfies PageServerLoad;
