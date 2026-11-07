import type { Generated, Insertable, Selectable } from 'kysely';

export type VisitOutcome = 'valid' | 'invalid';

export interface VisitTable {
	id: Generated<number>;
	domain: string;
	path: string;
	outcome: VisitOutcome;
	visited_at: number;
	ip: string;
	user_agent: string | null;
	accept_language: string | null;
	browser: string;
	os: string;
}

export interface AnalyticsReportTable {
	id: Generated<number>;
	scope_kind: 'overview' | 'domain' | 'link';
	domain: string | null;
	path: string | null;
	summary_json: string;
	details_json: string;
}

export interface Database {
	visits: VisitTable;
	analytics_reports: AnalyticsReportTable;
}

export type ClassifiedVisit = Omit<Insertable<VisitTable>, 'id'>;
export type NewVisit = Omit<ClassifiedVisit, 'browser' | 'os'>;
export type Visit = Selectable<VisitTable>;
