import type { NewVisit } from '@goto/db';
import type { IncomingMessage } from 'node:http';
import { readClientAddress } from '../ingress.js';
import type { ResolvedVisit } from '../redirect.js';

export function captureVisit(
	request: IncomingMessage,
	visit: ResolvedVisit | undefined,
	recordVisit: ((visit: NewVisit) => void) | undefined,
	retentionMonths: number
): void {
	if (!visit || !recordVisit) return;
	try {
		const captured: NewVisit = {
			domain: visit.domain,
			path: visit.path,
			outcome: visit.outcome,
			visited_at: visit.visitedAt,
			ip: null,
			user_agent: null,
			accept_language: null
		};
		if (retentionMonths === 0) {
			recordVisit(captured);
			return;
		}
		captured.ip = readClientAddress(request) ?? null;
		const rawUserAgent = request.headers['user-agent'];
		const rawAcceptLanguage = request.headers['accept-language'];
		captured.user_agent = typeof rawUserAgent === 'string' ? rawUserAgent : null;
		captured.accept_language = typeof rawAcceptLanguage === 'string' ? rawAcceptLanguage : null;
		recordVisit(captured);
	} catch {
		return;
	}
}
