import { error } from '@sveltejs/kit';
import type { VisitCounts, StoredVisitReports } from '@goto/db/visit-reports';
import { currentLinkState } from '#lib/server/link-state.js';
import { readVisitReport } from '#lib/server/visit-reports.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const snapshot = locals.snapshot;
	const domain = params.domain;
	if (!Object.hasOwn(snapshot.domains, domain)) throw error(404, 'Domain not configured');
	const prepared = snapshot.domains[domain]!;
	const configuration = snapshot.configuration;
	const collectionEnabled = configuration.analytics.retention_months !== 0;
	let preparedReports: StoredVisitReports | null = null;
	if (collectionEnabled) preparedReports = await readVisitReport(configuration, domain);
	const report = preparedReports?.report;

	const countsByPath = new Map<string, VisitCounts>();
	for (const row of report?.linkCounts ?? []) countsByPath.set(row.path, row.counts);
	const baseCounts = countsByPath.get('/') ?? null;
	let invalidClicks: number | null = null;
	if (report && baseCounts) invalidClicks = report.totals.invalid - baseCounts.invalid;
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

	return {
		domain,
		retentionMonths: configuration.analytics.retention_months,
		collectionEnabled,
		available: preparedReports !== null,
		since: preparedReports?.period.since ?? null,
		asOf: preparedReports?.period.asOf ?? null,
		linkCount: links.length,
		totals: report?.totals ?? null,
		invalidClicks,
		base: {
			url: baseUrl,
			state: baseState,
			counts: baseCounts,
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
