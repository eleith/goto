import { matchLink, type MatchingDomain } from './matching.js';
import { normalizeHost, reservedStaticPrefix } from './paths.js';

export function isSelfRedirect(
	destination: string,
	host: string,
	path: string,
	domain?: MatchingDomain
): boolean {
	const normalizedHost = normalizeHost(host);
	if (normalizedHost === undefined) return false;

	try {
		const url = new URL(destination);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
		const authoredAuthority = /^https?:\/\/([^/?#\\]+)/i.exec(destination)?.[1];
		const sameHost =
			normalizeHost(url.host) === normalizedHost ||
			(authoredAuthority !== undefined && normalizeHost(authoredAuthority) === normalizedHost);
		if (!sameHost) return false;
		const destinationPath = decodeURIComponent(url.pathname);
		if (destinationPath === path) return true;
		if (destinationPath.startsWith(reservedStaticPrefix)) return false;
		if (domain === undefined || path === '/' || destinationPath === '/') return false;
		const source = matchLink(domain, path);
		const target = matchLink(domain, destinationPath);
		return source !== undefined && target !== undefined && source.path === target.path;
	} catch {
		return false;
	}
}
