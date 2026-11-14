import { isSelfRedirect, type PreparedDomain, type PreparedLink } from '@goto/config';
import type { VisitOutcome } from '@goto/db';
import type { Immutable } from './snapshot.js';

export interface ResolvedVisit {
	domain: string;
	path: string;
	outcome: VisitOutcome;
	visitedAt: number;
}

export interface RedirectResult {
	response: Response;
	visit?: ResolvedVisit;
}

interface ParsedTarget {
	path: string;
	query: string;
}

interface ResolvedResponse {
	response: Response;
	outcome: VisitOutcome;
}

function parseTarget(target: string): ParsedTarget | undefined {
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

function emptyResponse(status: number): Response {
	return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}

function redirectResponse(destination: string, status: number): Response {
	const location = serializeLocation(destination);
	const headers = { 'cache-control': 'no-store', location };
	return new Response(null, { status, headers });
}

function findActiveLink(
	domain: Immutable<PreparedDomain>,
	path: string,
	now: number
): Immutable<PreparedLink> | undefined {
	const link = Object.hasOwn(domain.links, path) ? domain.links[path] : undefined;
	if (!link || !link.enabled) return;
	const started = link.valid_from === undefined || now >= Date.parse(link.valid_from);
	const notExpired = link.valid_until === undefined || now < Date.parse(link.valid_until);
	if (started && notExpired) return link;
}

function resolveVisitResponse(
	domain: Immutable<PreparedDomain>,
	host: string,
	target: ParsedTarget,
	now: number
): ResolvedResponse {
	const isRoot = target.path === '/';
	let redirect = domain.fallback;
	let outcome: VisitOutcome = 'invalid';
	if (isRoot) {
		outcome = 'valid';
		if (domain.root !== null) redirect = domain.root;
	} else {
		const link = findActiveLink(domain, target.path, now);
		if (link) {
			redirect = link;
			outcome = 'valid';
		}
	}

	if (redirect === null) {
		const response = emptyResponse(404);
		return { response, outcome };
	}

	let destination = redirect.url;
	if (redirect.forward_query) destination = forwardQuery(destination, target.query);
	const selfRedirect = isSelfRedirect(destination, host, target.path);
	if (selfRedirect) {
		const response = emptyResponse(404);
		if (!isRoot) outcome = 'invalid';
		return { response, outcome };
	}

	const response = redirectResponse(destination, redirect.status_code);
	return { response, outcome };
}

export function resolveRedirect(
	domain: Immutable<PreparedDomain>,
	host: string,
	target: string,
	method: string,
	now: number = Date.now()
): RedirectResult {
	if (method !== 'GET' && method !== 'HEAD') {
		const response = emptyResponse(405);
		response.headers.set('allow', 'GET, HEAD');
		return { response };
	}

	const parsed = parseTarget(target);
	if (parsed === undefined) {
		const response = emptyResponse(400);
		return { response };
	}

	const resolved = resolveVisitResponse(domain, host, parsed, now);
	const response = resolved.response;
	if (method === 'HEAD') return { response };
	const visit: ResolvedVisit = {
		domain: host,
		path: parsed.path,
		outcome: resolved.outcome,
		visitedAt: now
	};
	return { response, visit };
}
