import type { Generated, Insertable, Selectable } from 'kysely';

export interface VisitTable {
	id: Generated<number>;
	domain: string;
	path: string;
	visited_at: number;
	ip: string;
	user_agent: string | null;
	accept_language: string | null;
}

export interface Database {
	visits: VisitTable;
}

export type NewVisit = Omit<Insertable<VisitTable>, 'id'>;
export type Visit = Selectable<VisitTable>;
