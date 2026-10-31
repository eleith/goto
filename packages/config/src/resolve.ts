import { ConfigError } from './errors.js';
import { isCanonicalPath, normalizeHost } from './paths.js';
import type { DomainConfiguration, GotoConfiguration, LinkConfiguration } from './schema.js';
import type { PreparedDomain, PreparedLink, SettingSource } from './types.js';

function settingSource(
	key: keyof GotoConfiguration['defaults'],
	global: object,
	domain: DomainConfiguration,
	link?: LinkConfiguration
): SettingSource {
	if (link && Object.hasOwn(link, key)) return 'link';
	if (Object.hasOwn(domain.defaults, key)) return 'domain';
	return Object.hasOwn(global, key) ? 'global' : 'builtin';
}

function prepareLink(
	path: string,
	link: LinkConfiguration,
	domain: DomainConfiguration,
	configuration: GotoConfiguration,
	global: object
): PreparedLink {
	if (!isCanonicalPath(path)) throw new ConfigError();
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
			link.status_code ?? domain.defaults.status_code ?? configuration.defaults.status_code,
		forward_query:
			link.forward_query ?? domain.defaults.forward_query ?? configuration.defaults.forward_query,
		provenance: {
			status_code: settingSource('status_code', global, domain, link),
			forward_query: settingSource('forward_query', global, domain, link)
		}
	};
}

export function prepareDomains(
	configuration: GotoConfiguration,
	authoredDefaults: object
): Record<string, PreparedDomain> {
	const domains: Record<string, PreparedDomain> = Object.create(null);
	const adminHost = normalizeHost(new URL(configuration.site.url).host);
	for (const [key, domain] of Object.entries(configuration.domains)) {
		const host = normalizeHost(key);
		if (!host || host === adminHost || Object.hasOwn(domains, host)) {
			throw new ConfigError();
		}
		const links: Record<string, PreparedLink> = Object.create(null);
		for (const [path, link] of Object.entries(domain.links)) {
			links[path] = prepareLink(path, link, domain, configuration, authoredDefaults);
		}
		domains[host] = {
			fallback: domain.defaults.fallback ?? configuration.defaults.fallback,
			provenance: { fallback: settingSource('fallback', authoredDefaults, domain) },
			links
		};
	}
	return domains;
}
