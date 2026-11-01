import type { IncomingMessage } from 'node:http';
import type { Application } from './application.js';
import { isLocalProbe, readIngress } from './ingress.js';
import { resolveRedirect } from './redirect.js';
import { bindApplication } from './request-context.js';

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
	if (Object.hasOwn(application.domains, ingress.host)) {
		return resolveRedirect(
			application.domains[ingress.host]!,
			ingress.host,
			request.url!,
			request.method ?? 'GET'
		);
	}
	if (ingress.url.origin === application.configuration.site.url) {
		bindApplication(request, application, ingress.url.origin);
		return;
	}
	if (isLocalProbe(request, ingress.url)) return response(200);
	return response(404);
}
