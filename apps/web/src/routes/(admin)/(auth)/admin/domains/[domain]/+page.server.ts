import { error } from '@sveltejs/kit';
import type { DomainSummary, VisitTotals } from '@goto/analytics';
import { currentLinkState } from '#lib/server/link-state.js';
import { readVisitSummary } from '#lib/server/visit-reports.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const snapshot = locals.snapshot;
	const domain = params.domain;
	if (!Object.hasOwn(snapshot.domains, domain)) throw error(404, 'Domain not configured');
	const prepared = snapshot.domains[domain]!;
	const configuration = snapshot.configuration;
	const collectionEnabled = configuration.analytics.retention_months !== 0;
	let domainSummary: DomainSummary | null = null;
	if (collectionEnabled) {
		const scope = { kind: 'domain' as const, domain };
		const summary = await readVisitSummary(configuration, scope);
		if (summary && 'links' in summary) domainSummary = summary;
	}
	const countsByPath = new Map<string, VisitTotals>();
	for (const row of domainSummary?.links ?? []) countsByPath.set(row.path, row.totals);
	const now = Date.now();
	const links = Object.entries(prepared.links).map(([path, link]) => ({
		path,
		url: link.url,
		state: currentLinkState(link, now),
		counts: countsByPath.get(path) ?? null,
		href: linkHref(domain, path)
	}));
	const root = prepared.links['/'];
	let baseUrl = prepared.fallback === 404 ? null : prepared.fallback;
	let baseState = 'Fallback';
	if (root && currentLinkState(root, now) === 'Active') {
		baseUrl = root.url;
		baseState = 'Active';
	}
	let invalidClicks: number | null = null;
	if (domainSummary) {
		invalidClicks = domainSummary.totals.invalidVisits - domainSummary.base.invalidVisits;
	}

	const asOf = domainSummary ? Date.parse(domainSummary.period.asOf) : null;
	return {
		domain,
		retentionMonths: configuration.analytics.retention_months,
		collectionEnabled,
		available: domainSummary !== null,
		asOf,
		linkCount: links.length,
		totals: domainSummary?.totals ?? null,
		invalidClicks,
		base: {
			url: baseUrl,
			state: baseState,
			counts: domainSummary?.base ?? null,
			href: linkHref(domain, '/')
		},
		links
	};
};

function linkHref(domain: string, path: string): string {
	const base = `/admin/domains/${encodeURIComponent(domain)}/links`;
	if (path === '/') return base;
	const segments = path.slice(1).split('/').map(encodeURIComponent);
	return `${base}/${segments.join('/')}`;
}
