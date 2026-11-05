import type { Generated, Insertable, Selectable } from 'kysely';

export interface VisitTable {
	id: Generated<number>;
	domain: string;
	path: string;
	visited_at: number;
	ip: string;
	user_agent: string | null;
	accept_language: string | null;
	browser: string;
	os: string;
}

export interface VisitCollectionTable {
	id: number;
	collect_after: number | null;
}

export interface Database {
	visits: VisitTable;
	visit_collection: VisitCollectionTable;
}

export type ClassifiedVisit = Omit<Insertable<VisitTable>, 'id'>;
export type NewVisit = Omit<ClassifiedVisit, 'browser' | 'os'>;
export type Visit = Selectable<VisitTable>;
