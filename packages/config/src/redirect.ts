import { normalizeHost } from './paths.js';

export function isSelfRedirect(destination: string, host: string, path: string): boolean {
	const normalizedHost = normalizeHost(host);
	if (normalizedHost === undefined) return false;

	try {
		const url = new URL(destination);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
		const authoredAuthority = /^https?:\/\/([^/?#\\]+)/i.exec(destination)?.[1];
		const sameHost =
			normalizeHost(url.host) === normalizedHost ||
			(authoredAuthority !== undefined && normalizeHost(authoredAuthority) === normalizedHost);
		return sameHost && decodeURIComponent(url.pathname) === path;
	} catch {
		return false;
	}
}
