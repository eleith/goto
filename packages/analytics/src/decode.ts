import type { ReportScope, VisitDetails, VisitSummary } from './reports.js';
import { checkDetails, checkSummary, invalidReport, sameScope } from './validation.js';

export function parseVisitSummary(json: string, expectedScope: ReportScope): VisitSummary {
	const document = parseDocument(json);
	const summary = checkSummary(document);
	if (!sameScope(summary.scope, expectedScope)) throw invalidReport();
	return summary;
}

export function parseVisitDetails(json: string, expectedScope: ReportScope): VisitDetails {
	const document = parseDocument(json);
	const details = checkDetails(document);
	if (!sameScope(details.scope, expectedScope)) throw invalidReport();
	return details;
}

function parseDocument(json: string): unknown {
	try {
		return JSON.parse(json);
	} catch {
		throw invalidReport();
	}
}
