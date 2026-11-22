import { error } from '@sveltejs/kit';
import { readLastActivity } from '#lib/server/visits/reports.js';
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
	const analyticsEnabled = configuration.analytics.retention_months !== 0;
	const scope = { kind: 'link' as const, domain, path: '/' };
	const totals = await readLifetimeVisitTotals(configuration, scope);
	const activity = analyticsEnabled ? await readLastActivity(configuration, scope) : null;

	return {
		domain,
		totalVisits: totals?.validVisits ?? null,
		domainHref: `/admin/domains/${encodeURIComponent(domain)}`,
		response,
		fallback,
		fallbackSource: prepared.provenance.fallback,
		analyticsEnabled,
		lastActivityAt: activity?.lastActivityAt ? Date.parse(activity.lastActivityAt) : null
	};
}) satisfies PageServerLoad;
