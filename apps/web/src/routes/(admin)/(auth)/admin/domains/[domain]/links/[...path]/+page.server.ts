import { error } from '@sveltejs/kit';
import type { VisitSummary } from '@goto/analytics';
import { currentLinkState } from '#lib/server/link-state.js';
import { readVisitSummary } from '#lib/server/visit-reports.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const snapshot = locals.snapshot;
	const domain = params.domain;
	if (!Object.hasOwn(snapshot.domains, domain)) throw error(404, 'Domain not configured');
	const prepared = snapshot.domains[domain]!;
	// Kit has decoded route parameters; preserve literal percent paths as-is.
	const path = `/${params.path ?? ''}`;
	if (path !== '/' && !Object.hasOwn(prepared.links, path)) throw error(404, 'Link not configured');
	const link = prepared.links[path];
	const configuration = snapshot.configuration;
	const collectionEnabled = configuration.analytics.retention_months !== 0;
	let linkSummary: VisitSummary | null = null;
	if (collectionEnabled) {
		const scope = { kind: 'link' as const, domain, path };
		linkSummary = await readVisitSummary(configuration, scope);
	}
	const state = link ? currentLinkState(link, Date.now()) : 'Fallback';
	const asOf = linkSummary ? Date.parse(linkSummary.period.asOf) : null;

	return {
		domain,
		path,
		domainHref: `/admin/domains/${encodeURIComponent(domain)}`,
		url: link?.url ?? null,
		fallback: prepared.fallback,
		state,
		retentionMonths: configuration.analytics.retention_months,
		collectionEnabled,
		available: linkSummary !== null,
		asOf,
		totals: linkSummary?.totals ?? null
	};
};
