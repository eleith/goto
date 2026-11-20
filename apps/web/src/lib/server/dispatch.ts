import { isReservedLinkPath, reservedStaticPrefix, type PreparedDomain } from '@goto/config';
import type { IncomingMessage } from 'node:http';
import type { Application } from './application.js';
import { isLocalProbe, readIngress, type Ingress } from './ingress.js';
import { resolveRedirect } from './redirect.js';
import type { RedirectRequestHeaders } from './redirects/conditions.js';
import { bindApplication, requestContext } from './request-context.js';
import { captureVisit } from './visits/capture.js';
import { renderPublicError } from './redirects/error.js';
import type { ConfigurationSnapshot, Immutable } from './snapshot.js';

const noStoreRouteSegments = new Set(['admin', 'auth', 'signin']);

type PublishedAssetPath = NonNullable<ReturnType<typeof publishedAssetPath>>;
type AssetMethod = 'GET' | 'HEAD';
type RedirectHostAssetReader<AssetResponse> = (
	path: PublishedAssetPath,
	method: AssetMethod
) => AssetResponse;

export function handleIngress<AssetResponse extends Response | Promise<Response> = never>(
	application: Application,
	request: IncomingMessage,
	env: NodeJS.ProcessEnv = process.env,
	defaultProtocol: 'http' | 'https' = 'https',
	serveRedirectHostAsset?: RedirectHostAssetReader<AssetResponse>
): Response | AssetResponse | undefined {
	const ingress = readIngress(request, env, defaultProtocol);
	if (!ingress) return emptyResponse(400);
	const snapshot = application.currentSnapshot();
	const isAdminOrigin = ingress.url.origin === snapshot.configuration.url.app;
	const redirectDomain = Object.hasOwn(snapshot.domains, ingress.host)
		? snapshot.domains[ingress.host]
		: undefined;
	if (!isAdminOrigin && !redirectDomain) {
		if (isLocalProbe(request, ingress.url)) return emptyResponse(200);
		return emptyResponse(404);
	}

	const target = request.url!;
	const rawPathname = target.split('?', 1)[0]!;
	const method = request.method ?? 'GET';
	const assetMethod = method === 'GET' || method === 'HEAD' ? method : undefined;
	const isSharedHost = redirectDomain?.sharesAppHost === true;
	const needsDecodedPath = assetMethod !== undefined || isSharedHost;
	const decodedRawPathname = needsDecodedPath ? decodePathname(rawPathname) : undefined;
	const urlPathname = ingress.url.pathname;
	const isReservedPath = isSharedHost && isReservedRequestPath(decodedRawPathname, urlPathname);
	if (isReservedPath && !isAdminOrigin) return emptyResponse(404);

	const assetPath = publishedAssetPath(decodedRawPathname);
	if (assetPath && assetMethod) {
		const isRedirectOnlyHost = redirectDomain !== undefined && !isSharedHost;
		const assetReader = isRedirectOnlyHost ? serveRedirectHostAsset : undefined;
		const response = publishedAssetResponse(
			assetPath,
			assetMethod,
			target,
			rawPathname,
			assetReader
		);
		if (response !== undefined) return response;
		bindApplication(request, application, ingress.url.origin, snapshot);
		return;
	}

	if (redirectDomain && !isReservedPath) {
		if (decodedRawPathname?.startsWith(reservedStaticPrefix)) {
			return renderPublicError(emptyResponse(404), ingress.url.origin, method);
		}
		return handleRedirectHostRequest(application, request, snapshot, ingress, redirectDomain);
	}

	bindApplication(request, application, ingress.url.origin, snapshot);
}

export function adminCacheControl(request: IncomingMessage): string | undefined {
	const context = requestContext(request);
	if (!context?.origin || context.origin !== context.snapshot.configuration.url.app) return;
	if (request.url === undefined) return;

	try {
		const url = new URL(context.origin + request.url);
		const firstSegment = url.pathname.split('/', 2)[1] ?? '';
		const routeSegment = decodeURI(firstSegment);
		if (noStoreRouteSegments.has(routeSegment)) return 'private, no-store';
	} catch {
		// Malformed targets follow normal request handling.
	}
}

function publishedAssetResponse<AssetResponse extends Response | Promise<Response>>(
	path: PublishedAssetPath,
	method: AssetMethod,
	target: string,
	rawPathname: string,
	assetReader: RedirectHostAssetReader<AssetResponse> | undefined
): Response | AssetResponse | undefined {
	if (path === rawPathname) return assetReader?.(path, method);

	const query = target.slice(rawPathname.length);
	const response = emptyResponse(308);
	response.headers.set('location', path + query);
	return response;
}

function handleRedirectHostRequest(
	application: Application,
	request: IncomingMessage,
	snapshot: ConfigurationSnapshot,
	ingress: Ingress,
	domain: Immutable<PreparedDomain>
): Response {
	const method = request.method ?? 'GET';
	const redirect = resolveRedirect(
		domain,
		ingress.host,
		request.url!,
		method,
		application.linkVisitCount,
		readRedirectRequestHeaders(request)
	);
	captureVisit(
		request,
		redirect.visit,
		application.recordVisit,
		snapshot.configuration.analytics.retention_months
	);
	if (redirect.response.status !== 404) return redirect.response;
	return renderPublicError(redirect.response, ingress.url.origin, method);
}

function isReservedRequestPath(
	decodedRawPathname: string | undefined,
	urlPathname: string
): boolean {
	if (decodedRawPathname !== undefined && isReservedLinkPath(decodedRawPathname)) return true;

	// The app uses the URL-normalized path; short links use the raw target.
	const decodedUrlPathname = decodePathname(urlPathname);
	return decodedUrlPathname !== undefined && isReservedLinkPath(decodedUrlPathname);
}

function decodePathname(pathname: string): string | undefined {
	try {
		return decodeURIComponent(pathname);
	} catch {
		// Malformed targets follow normal request handling.
	}
}

function publishedAssetPath(path: string | undefined) {
	switch (path) {
		case '/@static/favicon.svg':
		case '/@static/og.png':
		case '/@static/og.svg':
			return path;
	}
}

function emptyResponse(status: number): Response {
	return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}

function readRedirectRequestHeaders(request: IncomingMessage): RedirectRequestHeaders {
	const acceptLanguage = request.headers['accept-language'];
	const userAgent = request.headers['user-agent'];
	return {
		acceptLanguage: typeof acceptLanguage === 'string' ? acceptLanguage : undefined,
		userAgent: typeof userAgent === 'string' ? userAgent : undefined
	};
}
