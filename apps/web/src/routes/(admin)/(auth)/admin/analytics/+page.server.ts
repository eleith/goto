import { countBreakdownVisitsByTimeframe, type ReportScope } from '@goto/analytics';
import { availableVisitTimeframes, countVisitWindows, visitWindow } from '@goto/analytics/daily';
import { normalizeHost } from '@goto/config';
import { error, redirect } from '@sveltejs/kit';
import { readVisitDetails } from '#lib/server/visits/reports.js';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals, url }) => {
	const snapshot = locals.snapshot;
	const configuration = snapshot.configuration;
	const retentionMonths = configuration.analytics.retention_months;
	if (retentionMonths === 0) redirect(307, '/admin/health');

	const requestedDomains = url.searchParams.getAll('domain');
	if (requestedDomains.length > 1) error(400, 'Select only one domain');
	const domain = requestedDomains[0] ?? null;
	if (domain !== null && !isCanonicalHost(domain)) error(400, 'Invalid domain selection');

	const domains = Object.keys(snapshot.domains).sort();
	const timeframes = availableVisitTimeframes(retentionMonths);
	const domainUnavailable = domain !== null && !Object.hasOwn(snapshot.domains, domain);
	const selection = { domain, domains, domainUnavailable, retentionMonths, timeframes };
	if (domainUnavailable) return { ...selection, report: null };

	const scope: ReportScope = domain === null ? { kind: 'overview' } : { kind: 'domain', domain };
	const details = await readVisitDetails(configuration, scope);
	if (!details) return { ...selection, report: null };

	const windows = timeframes.map((timeframe) => ({
		timeframe,
		window: visitWindow(details.period, timeframe)
	}));
	return {
		...selection,
		report: {
			period: details.period,
			daily: details.daily,
			lastActivityAt: details.lastActivityAt ? Date.parse(details.lastActivityAt) : null,
			countsByTimeframe: countVisitWindows(details.daily, windows),
			browserVisitsByTimeframe: countBreakdownVisitsByTimeframe(details.browsers, windows),
			operatingSystemVisitsByTimeframe: countBreakdownVisitsByTimeframe(
				details.operatingSystems,
				windows
			),
			acceptedLanguageVisitsByTimeframe: countBreakdownVisitsByTimeframe(
				details.acceptedLanguages,
				windows
			)
		}
	};
}) satisfies PageServerLoad;

function isCanonicalHost(host: string): boolean {
	return normalizeHost(host) === host;
}
