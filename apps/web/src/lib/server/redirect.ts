import { isSelfRedirect, type PreparedDomain } from '@goto/config';

function parseTarget(target: string): { path: string; query: string } | undefined {
	if (!target.startsWith('/') || target.includes('#') || target.includes('\\')) return undefined;
	if (!target.isWellFormed()) return undefined;
	for (let index = 0; index < target.length; index++) {
		const code = target.charCodeAt(index);
		if (code <= 32 || code === 127) return undefined;
	}

	const queryIndex = target.indexOf('?');
	const rawPath = queryIndex === -1 ? target : target.slice(0, queryIndex);
	const query = queryIndex === -1 ? '' : target.slice(queryIndex + 1);
	try {
		return { path: decodeURIComponent(rawPath), query };
	} catch {
		return undefined;
	}
}

function forwardQuery(destination: string, query: string): string {
	const incoming = new URLSearchParams(query);
	if (incoming.size === 0) return destination;

	const url = new URL(destination);
	for (const name of new Set(incoming.keys())) {
		url.searchParams.delete(name);
	}
	for (const [name, value] of incoming) {
		url.searchParams.append(name, value);
	}
	return url.href;
}

function serializeLocation(destination: string): string {
	for (const character of destination) {
		if (character.codePointAt(0)! > 127) return new URL(destination).href;
	}
	return destination;
}

export function resolveRedirect(
	domain: PreparedDomain,
	host: string,
	target: string,
	method: string,
	now: number = Date.now()
): Response {
	const headers = new Headers({ 'cache-control': 'no-store' });
	if (method !== 'GET' && method !== 'HEAD') {
		headers.set('allow', 'GET, HEAD');
		return new Response(null, { status: 405, headers });
	}

	const parsed = parseTarget(target);
	if (parsed === undefined) return new Response(null, { status: 400, headers });

	const link = Object.hasOwn(domain.links, parsed.path) ? domain.links[parsed.path] : undefined;
	const active =
		link !== undefined &&
		link.enabled &&
		(link.valid_from === undefined || now >= Date.parse(link.valid_from)) &&
		(link.valid_until === undefined || now < Date.parse(link.valid_until));
	let destination = domain.fallback;
	let status = 302;
	if (link !== undefined && active) {
		destination = link.forward_query ? forwardQuery(link.url, parsed.query) : link.url;
		status = link.status_code;
	}

	if (destination === 404 || isSelfRedirect(destination, host, parsed.path)) {
		return new Response(null, { status: 404, headers });
	}
	headers.set('location', serializeLocation(destination));
	return new Response(null, { status, headers });
}
