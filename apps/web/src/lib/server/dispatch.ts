import type { IncomingMessage } from 'node:http';
import type { Application } from './application.js';
import { isLocalProbe, readIngress } from './ingress.js';
import { resolveRedirect } from './redirect.js';
import { bindApplication } from './request-context.js';
import { captureVisit } from './visits/capture.js';

function response(status: number): Response {
	return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}

export function handleIngress(
	application: Application,
	request: IncomingMessage,
	env: NodeJS.ProcessEnv = process.env,
	defaultProtocol: 'http' | 'https' = 'https'
): Response | undefined {
	const ingress = readIngress(request, env, defaultProtocol);
	if (!ingress) return response(400);
	const snapshot = application.currentSnapshot();
	if (Object.hasOwn(snapshot.domains, ingress.host)) {
		const redirect = resolveRedirect(
			snapshot.domains[ingress.host]!,
			ingress.host,
			request.url!,
			request.method ?? 'GET'
		);
		if (snapshot.configuration.analytics.retention_months !== 0) {
			captureVisit(request, redirect.visit, application.recordVisit);
		}
		return redirect.response;
	}
	if (ingress.url.origin === snapshot.configuration.site.url) {
		bindApplication(request, application, ingress.url.origin, snapshot);
		return;
	}
	if (isLocalProbe(request, ingress.url)) return response(200);
	return response(404);
}
