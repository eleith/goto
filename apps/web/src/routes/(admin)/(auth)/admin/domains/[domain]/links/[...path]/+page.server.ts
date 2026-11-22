import { error } from '@sveltejs/kit';
import { currentLinkState } from '#lib/server/link-state.js';
import { readLastActivity } from '#lib/server/visits/reports.js';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals, params }) => {
	const snapshot = locals.snapshot;
	const domain = params.domain;
	if (!Object.hasOwn(snapshot.domains, domain)) throw error(404, 'Domain not configured');
	const prepared = snapshot.domains[domain]!;
	// Kit has decoded route parameters; preserve literal percent paths as-is.
	const path = `/${params.path ?? ''}`;
	if (!Object.hasOwn(prepared.links, path)) throw error(404, 'Link not configured');
	const link = prepared.links[path]!;
	const lifetimeVisits = locals.application.linkVisitCount(domain, path);
	const response = {
		url: link.url,
		status_code: link.status_code,
		forward_query: link.forward_query
	};
	const redirectRules = (link.redirect ?? []).map((rule) => ({
		language: rule.if.language ?? null,
		os: rule.if.os ?? null,
		to: rule.to
	}));
	const state = currentLinkState(link, Date.now(), lifetimeVisits);
	const validFrom = link.valid_from ?? null;
	const validUntil = link.valid_until ?? null;
	const configuration = snapshot.configuration;
	const analyticsEnabled = configuration.analytics.retention_months !== 0;
	const activity = analyticsEnabled
		? await readLastActivity(configuration, { kind: 'link', domain, path })
		: null;

	return {
		domain,
		path,
		linkTitle: link.title,
		lifetimeVisits,
		response,
		redirectRules,
		caseInsensitive: link.case_insensitive,
		ignoreTrailingSlash: link.ignore_trailing_slash,
		forwardPath: link.forward_path,
		maxVisits: link.max_visits ?? null,
		state,
		validFrom,
		validUntil,
		tags: link.tags,
		analyticsEnabled,
		lastActivityAt: activity?.lastActivityAt ? Date.parse(activity.lastActivityAt) : null
	};
}) satisfies PageServerLoad;
