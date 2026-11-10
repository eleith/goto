import type { ReportPeriod, ReportScope, VisitDetails, VisitSummary } from './reports.js';
import { checkDetails, checkSummary, invalidReport, samePeriod, sameScope } from './validation.js';

export function parseVisitSummary(json: string, expectedScope: ReportScope): VisitSummary {
	const document = parseDocument(json);
	const summary = checkSummary(document);
	if (!sameScope(summary.scope, expectedScope)) throw invalidReport();
	return summary;
}

export function parseVisitDetails(
	json: string,
	expectedScope: ReportScope,
	expectedPeriod?: ReportPeriod
): VisitDetails {
	const document = parseDocument(json);
	const details = checkDetails(document);
	if (!sameScope(details.scope, expectedScope)) throw invalidReport();
	if (expectedPeriod && !samePeriod(details.period, expectedPeriod)) throw invalidReport();
	return details;
}

function parseDocument(json: string): unknown {
	try {
		return JSON.parse(json);
	} catch {
		throw invalidReport();
	}
}
