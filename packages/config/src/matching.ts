import { hasControlCharacters } from './text.js';
import type { PreparedLink } from './types.js';

export interface MatchingDomain {
	readonly links: Readonly<
		Record<
			string,
			Pick<PreparedLink, 'case_insensitive' | 'ignore_trailing_slash' | 'forward_path'>
		>
	>;
	readonly caseInsensitivePaths: Readonly<Record<string, string>>;
}

export function matchLink(
	domain: MatchingDomain,
	path: string
): { path: string; suffix: string } | undefined {
	const exact = configuredPath(domain, path);
	if (exact !== undefined) return { path: exact, suffix: '' };

	if (path.endsWith('/')) {
		const withoutSlash = configuredPath(domain, path.slice(0, -1));
		if (withoutSlash !== undefined && domain.links[withoutSlash]?.ignore_trailing_slash) {
			return { path: withoutSlash, suffix: '' };
		}
	}

	const hasUnsafeForwardingPath =
		path.includes('\\') ||
		hasControlCharacters(path) ||
		path.split('/').some((segment) => segment === '.' || segment === '..');
	if (hasUnsafeForwardingPath) return undefined;

	for (
		let boundary = path.lastIndexOf('/');
		boundary > 0;
		boundary = path.lastIndexOf('/', boundary - 1)
	) {
		const prefix = configuredPath(domain, path.slice(0, boundary));
		if (prefix === undefined || !domain.links[prefix]?.forward_path) continue;
		const suffix = path.slice(boundary);
		const hasAdditionalPathSegment = /[^/]/.test(suffix);
		if (hasAdditionalPathSegment) return { path: prefix, suffix };
	}
	return undefined;
}

export function foldAsciiCase(path: string): string {
	return path.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function configuredPath(domain: MatchingDomain, path: string): string | undefined {
	if (Object.hasOwn(domain.links, path)) return path;
	const folded = foldAsciiCase(path);
	if (Object.hasOwn(domain.caseInsensitivePaths, folded)) {
		return domain.caseInsensitivePaths[folded];
	}
	return undefined;
}
