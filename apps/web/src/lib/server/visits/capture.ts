import type { NewVisit } from '@goto/db';
import type { IncomingMessage } from 'node:http';
import { readClientAddress } from '../ingress.js';
import type { ResolvedVisit } from '../redirect.js';

export function captureVisit(
	request: IncomingMessage,
	visit: ResolvedVisit | undefined,
	recordVisit: ((visit: NewVisit) => void) | undefined
): void {
	if (!visit || !recordVisit) return;
	try {
		const ip = readClientAddress(request);
		if (!ip) return;
		const rawUserAgent = request.headers['user-agent'];
		const rawAcceptLanguage = request.headers['accept-language'];
		const userAgent = typeof rawUserAgent === 'string' ? rawUserAgent : null;
		const acceptLanguage = typeof rawAcceptLanguage === 'string' ? rawAcceptLanguage : null;
		recordVisit({
			domain: visit.domain,
			path: visit.path,
			outcome: visit.outcome,
			visited_at: visit.visitedAt,
			ip,
			user_agent: userAgent,
			accept_language: acceptLanguage
		});
	} catch {
		return;
	}
}
