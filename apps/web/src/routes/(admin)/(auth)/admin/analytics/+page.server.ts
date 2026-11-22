import { countBreakdownVisitsByTimeframe } from '@goto/analytics';
import { availableVisitTimeframes, countVisitWindows, visitWindow } from '@goto/analytics/daily';
import { isCanonicalPath, normalizeHost } from '@goto/config';
import { error, redirect } from '@sveltejs/kit';
import type { ConfigurationSnapshot } from '#lib/server/snapshot.js';
import { currentTags, tagMembers } from '#lib/server/tags/inventory.js';
import { combineTagVisits } from '#lib/server/tags/visits.js';
import { readLinkDetails, readVisitDetails } from '#lib/server/visits/reports.js';
import { scopeValue, type AnalyticsScope, type ScopeGroup } from './report-scopes.js';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals, url }) => {
	const snapshot = locals.snapshot;
	const retentionMonths = snapshot.configuration.analytics.retention_months;
	if (retentionMonths === 0) redirect(307, '/admin/health');

	const scope = selectedScope(url.searchParams);
	const groups = scopeGroups(snapshot.domains);
	const scopeUnavailable = !isConfiguredScope(scope, groups);
	const timeframes = availableVisitTimeframes(retentionMonths);
	const selection = { scope, groups, scopeUnavailable, retentionMonths, timeframes };
	if (scopeUnavailable) return { ...selection, report: null };

	const details = await readScopeDetails(snapshot, scope);
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

function selectedScope(query: URLSearchParams): AnalyticsScope {
	const domains = query.getAll('domain');
	const paths = query.getAll('path');
	const tags = query.getAll('tag');
	if (domains.length > 1 || paths.length > 1 || tags.length > 1) {
		error(400, 'Select only one report scope');
	}

	const [domain] = domains;
	const [path] = paths;
	const [tag] = tags;
	if (tag !== undefined) {
		const conflictsWithTag = domain !== undefined || path !== undefined;
		const tagIsBlank = tag.trim() === '';
		if (conflictsWithTag || tagIsBlank) error(400, 'Invalid tag selection');
		return { kind: 'tag', tag };
	}
	if (domain !== undefined && normalizeHost(domain) !== domain) {
		error(400, 'Invalid domain selection');
	}
	if (path !== undefined) {
		if (domain === undefined || !isCanonicalPath(path)) error(400, 'Invalid redirect selection');
		return { kind: 'link', domain, path };
	}
	return domain === undefined ? { kind: 'overview' } : { kind: 'domain', domain };
}

function scopeGroups(domains: ConfigurationSnapshot['domains']): ScopeGroup[] {
	const hosts = Object.keys(domains).sort();
	return [
		{ label: 'Overview', scopes: [{ kind: 'overview' }] },
		{ label: 'Domains', scopes: hosts.map((domain) => ({ kind: 'domain', domain })) },
		{
			label: 'Redirects',
			scopes: hosts.flatMap((domain) =>
				['/', ...Object.keys(domains[domain]!.links).sort()].map((path) => ({
					kind: 'link',
					domain,
					path
				}))
			)
		},
		{ label: 'Tags', scopes: currentTags(domains).map((tag) => ({ kind: 'tag', tag })) }
	];
}

function isConfiguredScope(scope: AnalyticsScope, groups: ScopeGroup[]): boolean {
	const selectedValue = scopeValue(scope);
	return groups.some(({ scopes }) => scopes.some((option) => scopeValue(option) === selectedValue));
}

async function readScopeDetails(snapshot: ConfigurationSnapshot, scope: AnalyticsScope) {
	if (scope.kind !== 'tag') return readVisitDetails(snapshot.configuration, scope);

	const members = tagMembers(snapshot.domains, scope.tag);
	const identities = members.map(({ domain, path }) => ({ domain, path }));
	const report = await readLinkDetails(snapshot.configuration, identities);
	return report ? combineTagVisits(report) : null;
}
