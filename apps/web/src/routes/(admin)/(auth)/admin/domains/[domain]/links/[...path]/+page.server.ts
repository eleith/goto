import { error } from '@sveltejs/kit';
import type { StoredVisitReports } from '@goto/db/visit-reports';
import { currentLinkState } from '#lib/server/link-state.js';
import { readVisitReport } from '#lib/server/visit-reports.js';
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
	let reports: StoredVisitReports | null = null;
	if (collectionEnabled) reports = await readVisitReport(configuration, domain, path);
	const state = link ? currentLinkState(link, Date.now()) : 'Fallback';

	return {
		domain,
		path,
		domainHref: `/admin/domains/${encodeURIComponent(domain)}`,
		url: link?.url ?? null,
		fallback: prepared.fallback,
		state,
		retentionMonths: configuration.analytics.retention_months,
		collectionEnabled,
		available: reports !== null,
		since: reports?.period.since ?? null,
		asOf: reports?.period.asOf ?? null,
		totals: reports?.selection.totals ?? null
	};
};
