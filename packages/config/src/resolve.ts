import { ConfigError } from './errors.js';
import { isCanonicalPath, normalizeHost } from './paths.js';
import { isSelfRedirect } from './redirect.js';
import type { DomainConfiguration, GotoConfiguration, LinkConfiguration } from './schema.js';
import type { PreparedDomain, PreparedLink, SettingSource } from './types.js';

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

function prepareLink(
	path: string,
	link: LinkConfiguration,
	domain: DomainConfiguration,
	configuration: GotoConfiguration,
	global: object
): PreparedLink {
	if (path === '/' || !isCanonicalPath(path)) throw new ConfigError();
	if (
		link.valid_from !== undefined &&
		link.valid_until !== undefined &&
		Date.parse(link.valid_from) >= Date.parse(link.valid_until)
	) {
		throw new ConfigError();
	}
	return {
		...link,
		title: link.title ?? path,
		status_code:
			link.status_code ??
			domain.link_defaults.status_code ??
			configuration.link_defaults.status_code,
		forward_query:
			link.forward_query ??
			domain.link_defaults.forward_query ??
			configuration.link_defaults.forward_query,
		provenance: {
			status_code: linkSettingSource('status_code', global, domain, link),
			forward_query: linkSettingSource('forward_query', global, domain, link)
		}
	};
}

export function prepareDomains(
	configuration: GotoConfiguration,
	authoredLinkDefaults: object
): Record<string, PreparedDomain> {
	const domains: Record<string, PreparedDomain> = Object.create(null);
	const adminHost = normalizeHost(new URL(configuration.url.app).host);
	for (const [key, domain] of Object.entries(configuration.domains)) {
		const host = normalizeHost(key);
		if (!host || host === adminHost || Object.hasOwn(domains, host)) {
			throw new ConfigError();
		}
		if (domain.root && isSelfRedirect(domain.root.url, host, '/')) throw new ConfigError();
		const links: Record<string, PreparedLink> = Object.create(null);
		for (const [path, link] of Object.entries(domain.links)) {
			if (isSelfRedirect(link.url, host, path)) throw new ConfigError();
			links[path] = prepareLink(path, link, domain, configuration, authoredLinkDefaults);
		}
		let fallbackSource: SettingSource = 'builtin';
		if (domain.fallback) fallbackSource = 'domain';
		else if (configuration.fallback) fallbackSource = 'global';
		domains[host] = {
			root: domain.root ?? null,
			fallback: domain.fallback ?? configuration.fallback ?? null,
			provenance: { fallback: fallbackSource },
			links
		};
	}
	return domains;
}
