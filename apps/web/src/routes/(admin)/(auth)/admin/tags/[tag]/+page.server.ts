import { error } from '@sveltejs/kit';
import { linkHref } from '#lib/components/admin/urls.js';
import { currentLinkState } from '#lib/server/link-state.js';
import { tagMembers } from '#lib/server/tags/inventory.js';
import { readLastActivity } from '#lib/server/visits/reports.js';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals, params }) => {
	const snapshot = locals.snapshot;
	const tag = params.tag;
	const members = tagMembers(snapshot.domains, tag);
	if (members.length === 0) error(404, 'Tag not configured');

	const configuration = snapshot.configuration;
	const analyticsEnabled = configuration.analytics.retention_months !== 0;
	const activity = analyticsEnabled
		? await readLastActivity(
				configuration,
				members.map(({ domain, path }) => ({ kind: 'link' as const, domain, path }))
			)
		: null;
	const now = Date.now();
	const links = members.map(({ domain, path, link }) => {
		const visits = locals.application.linkVisitCount(domain, path);
		return {
			domain,
			path,
			state: currentLinkState(link, now, visits),
			visits,
			href: linkHref(domain, path)
		};
	});
	const domainCount = new Set(links.map(({ domain }) => domain)).size;
	const totalVisits = links.reduce((total, { visits }) => total + visits, 0);
	const lastActivityAt = activity?.lastActivityAt ? Date.parse(activity.lastActivityAt) : null;

	return { tag, analyticsEnabled, lastActivityAt, domainCount, totalVisits, links };
}) satisfies PageServerLoad;
