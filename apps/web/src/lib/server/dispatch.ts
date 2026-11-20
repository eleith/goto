import { reservedStaticPrefix } from '@goto/config';
import type { IncomingMessage } from 'node:http';
import type { Application } from './application.js';
import { isLocalProbe, readIngress, type Ingress } from './ingress.js';
import { resolveRedirect } from './redirect.js';
import type { RedirectRequestHeaders } from './redirects/conditions.js';
import { bindApplication, requestContext } from './request-context.js';
import { captureVisit } from './visits/capture.js';
import { renderPublicError } from './redirects/error.js';
import type { ConfigurationSnapshot } from './snapshot.js';

const noStoreRouteSegments = new Set(['admin', 'auth', 'signin']);

type PublishedAssetPath = NonNullable<ReturnType<typeof publishedAssetPath>>;

export function handleIngress<AssetResponse extends Response | Promise<Response> = never>(
	application: Application,
	request: IncomingMessage,
	env: NodeJS.ProcessEnv = process.env,
	defaultProtocol: 'http' | 'https' = 'https',
	serveRedirectHostAsset?: (path: PublishedAssetPath, method: 'GET' | 'HEAD') => AssetResponse
): Response | AssetResponse | undefined {
	const ingress = readIngress(request, env, defaultProtocol);
	if (!ingress) return emptyResponse(400);
	const snapshot = application.currentSnapshot();
	const isAdminOrigin = ingress.url.origin === snapshot.configuration.url.app;
	const isRedirectHost = Object.hasOwn(snapshot.domains, ingress.host);
	if (!isAdminOrigin && !isRedirectHost) {
		if (isLocalProbe(request, ingress.url)) return emptyResponse(200);
		return emptyResponse(404);
	}

	const target = request.url!;
	const rawPathname = target.split('?', 1)[0]!;
	const method = request.method ?? 'GET';
	const assetMethod = method === 'GET' || method === 'HEAD' ? method : undefined;
	const decodedReservedPath = assetMethod ? decodeReservedStaticPath(rawPathname) : undefined;
	const assetPath = publishedAssetPath(decodedReservedPath);
	if (assetPath && assetMethod) {
		if (assetPath !== rawPathname) {
			const response = emptyResponse(308);
			response.headers.set('location', assetPath + target.slice(rawPathname.length));
			return response;
		}
		if (isRedirectHost && serveRedirectHostAsset) {
			return serveRedirectHostAsset(assetPath, assetMethod);
		}
	} else if (isRedirectHost) {
		if (decodedReservedPath) {
			return renderPublicError(emptyResponse(404), ingress.url.origin, method);
		}
		return handleRedirectHostRequest(application, request, snapshot, ingress);
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

function handleRedirectHostRequest(
	application: Application,
	request: IncomingMessage,
	snapshot: ConfigurationSnapshot,
	ingress: Ingress
): Response {
	const domain = snapshot.domains[ingress.host]!;
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

function decodeReservedStaticPath(rawPathname: string): string | undefined {
	try {
		const decoded = decodeURIComponent(rawPathname);
		if (decoded.startsWith(reservedStaticPrefix)) return decoded;
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
