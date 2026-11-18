import { parseAcceptedLanguages } from '@goto/config/languages';
import type { Visit, VisitOutcome } from '@goto/db';

export interface VisitFacts {
	domain: string;
	path: string;
	outcome: VisitOutcome;
	day: string;
	visitedAt: number;
	browser: string;
	operatingSystem: string;
	languages: string[];
}

export function getVisitFacts(visit: Visit): VisitFacts {
	return {
		domain: visit.domain,
		path: visit.path,
		outcome: visit.path === '/' ? 'valid' : visit.outcome,
		day: new Date(visit.visited_at).toISOString().slice(0, 10),
		visitedAt: visit.visited_at,
		browser: visit.browser,
		operatingSystem: visit.os,
		languages: getVisitLanguages(visit.accept_language)
	};
}

export function getVisitLanguages(header: string | null): string[] {
	const { primaryLanguages } = parseAcceptedLanguages(header);
	return primaryLanguages.length === 0 ? ['Other'] : primaryLanguages;
}
