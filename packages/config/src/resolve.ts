import { normalizeLanguageTag } from './languages.js';
import { foldAsciiCase } from './matching.js';
import { normalizeHost } from './paths.js';
import type {
	DomainConfiguration,
	GotoConfiguration,
	LinkConfiguration,
	RedirectRule
} from './schema.js';
import type { PreparedDomain, PreparedLink, SettingSource } from './types.js';

export function buildRedirectDomainLookup(
	configuration: GotoConfiguration,
	authoredLinkDefaults: object
): Record<string, PreparedDomain> {
	const domains: Record<string, PreparedDomain> = Object.create(null);
	const adminHost = normalizeHost(new URL(configuration.url.app).host);
	for (const [key, domain] of Object.entries(configuration.domains)) {
		const host = normalizeHost(key)!;
		const links: Record<string, PreparedLink> = Object.create(null);
		for (const [path, link] of Object.entries(domain.links)) {
			links[path] = buildRedirectLink(link, domain, configuration, authoredLinkDefaults);
		}
		const caseInsensitivePaths = buildCaseInsensitivePathLookup(links);
		let fallbackSource: SettingSource = 'builtin';
		if (domain.fallback) fallbackSource = 'domain';
		else if (configuration.fallback) fallbackSource = 'global';
		const prepared: PreparedDomain = {
			root: domain.root ?? null,
			fallback: domain.fallback ?? configuration.fallback ?? null,
			provenance: { fallback: fallbackSource },
			links,
			caseInsensitivePaths
		};
		if (host === adminHost) prepared.sharesAppHost = true;
		domains[host] = prepared;
	}
	return domains;
}

function buildRedirectLink(
	link: LinkConfiguration,
	domain: DomainConfiguration,
	configuration: GotoConfiguration,
	global: object
): PreparedLink {
	const prepared: PreparedLink = {
		...link,
		status_code:
			link.status_code ??
			domain.link_defaults.status_code ??
			configuration.link_defaults.status_code,
		forward_query:
			link.forward_query ??
			domain.link_defaults.forward_query ??
			configuration.link_defaults.forward_query,
		case_insensitive:
			link.case_insensitive ??
			domain.link_defaults.case_insensitive ??
			configuration.link_defaults.case_insensitive,
		ignore_trailing_slash:
			link.ignore_trailing_slash ??
			domain.link_defaults.ignore_trailing_slash ??
			configuration.link_defaults.ignore_trailing_slash,
		forward_path:
			link.forward_path ??
			domain.link_defaults.forward_path ??
			configuration.link_defaults.forward_path,
		provenance: {
			status_code: linkSettingSource('status_code', global, domain, link),
			forward_query: linkSettingSource('forward_query', global, domain, link),
			case_insensitive: linkSettingSource('case_insensitive', global, domain, link),
			ignore_trailing_slash: linkSettingSource('ignore_trailing_slash', global, domain, link),
			forward_path: linkSettingSource('forward_path', global, domain, link)
		}
	};
	if (link.redirect !== undefined) prepared.redirect = link.redirect.map(normalizeRedirectRule);
	return prepared;
}

function normalizeRedirectRule(rule: RedirectRule): RedirectRule {
	if (rule.if.language === undefined) return rule;
	return {
		...rule,
		if: { ...rule.if, language: normalizeLanguageTag(rule.if.language) }
	};
}

function linkSettingSource(
	key: keyof GotoConfiguration['link_defaults'],
	global: object,
	domain: DomainConfiguration,
	link?: LinkConfiguration
): SettingSource {
	if (link && Object.hasOwn(link, key)) return 'link';
	if (Object.hasOwn(domain.link_defaults, key)) return 'domain';
	return Object.hasOwn(global, key) ? 'global' : 'builtin';
}

function buildCaseInsensitivePathLookup(
	links: Record<string, PreparedLink>
): Record<string, string> {
	const paths: Record<string, string> = Object.create(null);
	for (const [path, link] of Object.entries(links)) {
		if (!link.case_insensitive) continue;
		paths[foldAsciiCase(path)] = path;
	}
	return paths;
}
