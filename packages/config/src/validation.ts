import { Value } from '@sinclair/typebox/value';
import { ConfigError, toConfigIssue } from './errors.js';
import { foldAsciiCase } from './matching.js';
import { isCanonicalPath, normalizeHost } from './paths.js';
import { isSelfRedirect } from './redirect.js';
import {
	GotoConfigurationSchema,
	configurationReferences,
	type GotoConfiguration,
	type LinkConfiguration
} from './schema.js';
import type { PreparedDomain } from './types.js';

export function validateConfig(value: unknown): asserts value is GotoConfiguration {
	if (!Value.Check(GotoConfigurationSchema, configurationReferences, value)) {
		const issues = [...Value.Errors(GotoConfigurationSchema, configurationReferences, value)].map(
			toConfigIssue
		);
		throw new ConfigError(issues);
	}
	const adminHost = normalizeHost(new URL(value.url.app).host);
	const hosts = new Set<string>();
	for (const [key, domain] of Object.entries(value.domains)) {
		const host = normalizeHost(key);
		if (!host || host === adminHost || hosts.has(host)) throw new ConfigError();
		hosts.add(host);
		for (const [path, link] of Object.entries(domain.links)) {
			assertValidLinkPathAndDates(path, link);
		}
	}
}

export function validateRedirectDomainLookup(domains: Record<string, PreparedDomain>): void {
	for (const [host, domain] of Object.entries(domains)) {
		if (domain.root && isSelfRedirect(domain.root.url, host, '/')) throw new ConfigError();
		for (const path of Object.keys(domain.links)) {
			const alias = domain.caseInsensitivePaths[foldAsciiCase(path)];
			if (alias !== undefined && alias !== path) throw new ConfigError();
		}
		for (const [path, link] of Object.entries(domain.links)) {
			if (isSelfRedirect(link.url, host, path, domain)) throw new ConfigError();
			for (const rule of link.redirect ?? []) {
				if (isSelfRedirect(rule.to, host, path, domain)) throw new ConfigError();
			}
		}
	}
}

function assertValidLinkPathAndDates(path: string, link: LinkConfiguration): void {
	if (path === '/' || !isCanonicalPath(path)) throw new ConfigError();
	if (
		link.valid_from !== undefined &&
		link.valid_until !== undefined &&
		Date.parse(link.valid_from) >= Date.parse(link.valid_until)
	) {
		throw new ConfigError();
	}
}
