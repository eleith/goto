import type { Generated, Insertable, Selectable } from 'kysely';

export type VisitOutcome = 'valid' | 'invalid';

export interface VisitTable {
	id: Generated<number>;
	processed: Generated<0 | 1>;
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

export interface VisitDailyStatisticsTable {
	id: Generated<number>;
	scope_kind: 'overview' | 'domain' | 'link';
	domain: string | null;
	path: string | null;
	day: string;
	valid_visits: number;
	invalid_visits: number;
	last_visit_at: number;
	browsers_json: string;
	operating_systems_json: string;
	accepted_languages_json: string;
}

export interface Database {
	visits: VisitTable;
	visit_daily_statistics: VisitDailyStatisticsTable;
}

export type ClassifiedVisit = Omit<Insertable<VisitTable>, 'id' | 'processed'>;
export type NewVisit = Omit<ClassifiedVisit, 'browser' | 'os'>;
export type Visit = Selectable<VisitTable>;
