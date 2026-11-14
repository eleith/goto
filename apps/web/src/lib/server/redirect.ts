import {
	isSelfRedirect,
	matchLink,
	type PreparedDomain,
	type RedirectResponse
} from '@goto/config';
import type { VisitOutcome } from '@goto/db';
import { currentLinkState } from './link-state.js';
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
	path: string;
	outcome: VisitOutcome;
}

interface SelectedVisitRedirect {
	path: string;
	suffix: string;
	redirect: Immutable<RedirectResponse> | null;
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

function forwardPath(destination: string, suffix: string): string {
	const url = new URL(destination);
	const basePath = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
	const encodedSuffix = suffix.split('/').map(encodeURIComponent).join('/');
	url.pathname = basePath + encodedSuffix;
	return url.href;
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

function selectVisitRedirect(
	domain: Immutable<PreparedDomain>,
	requestedPath: string,
	now: number
): SelectedVisitRedirect {
	if (requestedPath === '/') {
		let redirect = domain.root;
		if (redirect === null) redirect = domain.fallback;
		return { path: '/', suffix: '', redirect, outcome: 'valid' };
	}

	const match = matchLink(domain, requestedPath);
	if (match === undefined) {
		return { path: requestedPath, suffix: '', redirect: domain.fallback, outcome: 'invalid' };
	}

	const link = domain.links[match.path]!;
	if (currentLinkState(link, now) !== 'active') {
		return { path: match.path, suffix: '', redirect: domain.fallback, outcome: 'invalid' };
	}

	return { path: match.path, suffix: match.suffix, redirect: link, outcome: 'valid' };
}

function resolveVisitResponse(
	domain: Immutable<PreparedDomain>,
	host: string,
	target: ParsedTarget,
	now: number
): ResolvedResponse {
	const { path, suffix, redirect, outcome } = selectVisitRedirect(domain, target.path, now);

	if (redirect === null) {
		const response = emptyResponse(404);
		return { response, path, outcome };
	}

	let destination = redirect.url;
	if (suffix !== '') destination = forwardPath(destination, suffix);
	if (redirect.forward_query) destination = forwardQuery(destination, target.query);
	const selfRedirect = isSelfRedirect(destination, host, target.path, domain);
	if (selfRedirect) {
		const response = emptyResponse(404);
		let loopOutcome: VisitOutcome = 'invalid';
		if (target.path === '/') loopOutcome = 'valid';
		return { response, path, outcome: loopOutcome };
	}

	const response = redirectResponse(destination, redirect.status_code);
	return { response, path, outcome };
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
		path: resolved.path,
		outcome: resolved.outcome,
		visitedAt: now
	};
	return { response, visit };
}
