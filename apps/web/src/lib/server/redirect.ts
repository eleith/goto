import {
	isSelfRedirect,
	matchLink,
	type PreparedDomain,
	type RedirectResponse
} from '@goto/config';
import type { VisitOutcome } from '@goto/db';
import { currentLinkState } from './link-state.js';
import {
	selectConditionalDestination,
	type RedirectRequestHeaders
} from './redirects/conditions.js';
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

export interface RedirectOptions extends RedirectRequestHeaders {
	now?: number;
}

type ReadLinkVisitCount = (domain: string, path: string) => number;

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
	vary?: string | undefined;
}

export function resolveRedirect(
	domain: Immutable<PreparedDomain>,
	host: string,
	target: string,
	method: string,
	readLinkVisitCount: ReadLinkVisitCount,
	options: RedirectOptions = {}
): RedirectResult {
	const now = options.now ?? Date.now();
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

	const resolved = resolveVisitResponse(domain, host, parsed, now, readLinkVisitCount, options);
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

function parseTarget(target: string): ParsedTarget | undefined {
	if (!hasValidRequestTargetSyntax(target)) return undefined;
	const queryIndex = target.indexOf('?');
	const rawPath = queryIndex === -1 ? target : target.slice(0, queryIndex);
	const query = queryIndex === -1 ? '' : target.slice(queryIndex + 1);
	try {
		return { path: decodeURIComponent(rawPath), query };
	} catch {
		return undefined;
	}
}

function hasValidRequestTargetSyntax(target: string): boolean {
	if (!target.startsWith('/') || target.includes('#') || target.includes('\\')) return false;
	if (!target.isWellFormed()) return false;
	for (let index = 0; index < target.length; index++) {
		const code = target.charCodeAt(index);
		if (code <= 32 || code === 127) return false;
	}
	return true;
}

function applyRequestForwarding(
	redirect: Immutable<RedirectResponse>,
	suffix: string,
	query: string
): string {
	let destination = redirect.url;
	if (suffix !== '') destination = forwardPath(destination, suffix);
	if (redirect.forward_query) destination = forwardQuery(destination, query);
	return destination;
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

function emptyResponse(status: number, vary?: string): Response {
	const response = new Response(null, { status, headers: { 'cache-control': 'no-store' } });
	if (vary !== undefined) response.headers.set('vary', vary);
	return response;
}

function redirectResponse(destination: string, status: number, vary?: string): Response {
	const response = emptyResponse(status, vary);
	response.headers.set('location', serializeLocation(destination));
	return response;
}

function selectVisitRedirect(
	domain: Immutable<PreparedDomain>,
	host: string,
	requestedPath: string,
	now: number,
	readLinkVisitCount: ReadLinkVisitCount,
	options: RedirectOptions
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
	const visits = readLinkVisitCount(host, match.path);
	if (currentLinkState(link, now, visits) !== 'active') {
		return { path: match.path, suffix: '', redirect: domain.fallback, outcome: 'invalid' };
	}

	if (link.redirect !== undefined && link.redirect.length > 0) {
		const destination = selectConditionalDestination(link.url, link.redirect, options);
		return {
			path: match.path,
			suffix: match.suffix,
			redirect: {
				url: destination.url,
				status_code: link.status_code,
				forward_query: link.forward_query
			},
			outcome: 'valid',
			vary: destination.vary
		};
	}
	return { path: match.path, suffix: match.suffix, redirect: link, outcome: 'valid' };
}

function resolveVisitResponse(
	domain: Immutable<PreparedDomain>,
	host: string,
	target: ParsedTarget,
	now: number,
	readLinkVisitCount: ReadLinkVisitCount,
	options: RedirectOptions
): ResolvedResponse {
	const { path, suffix, redirect, outcome, vary } = selectVisitRedirect(
		domain,
		host,
		target.path,
		now,
		readLinkVisitCount,
		options
	);

	if (redirect === null) {
		const response = emptyResponse(404);
		return { response, path, outcome };
	}

	const destination = applyRequestForwarding(redirect, suffix, target.query);
	const selfRedirect = isSelfRedirect(destination, host, target.path, domain);
	if (selfRedirect) {
		const response = emptyResponse(404, vary);
		let loopOutcome: VisitOutcome = 'invalid';
		if (target.path === '/') loopOutcome = 'valid';
		return { response, path, outcome: loopOutcome };
	}

	const response = redirectResponse(destination, redirect.status_code, vary);
	return { response, path, outcome };
}
