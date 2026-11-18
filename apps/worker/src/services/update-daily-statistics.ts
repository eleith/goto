import {
	emptyDailyStatistics,
	type DailyVisitStatistics,
	type ReportScope,
	type VisitTotals
} from '@goto/analytics';
import {
	addDailyVisitStatistics,
	subtractDailyVisitStatistics,
	type DailyStatisticsMismatch
} from '@goto/db/visit-reports';
import type { WorkerContext } from './context.js';
import type { VisitFacts } from './visit-facts.js';
import { logger } from './logger.js';

type DailyCount = DailyVisitStatistics['browsers'][number];

interface DailyAccumulator {
	statistics: DailyVisitStatistics;
	browsers: Map<string, DailyCount>;
	operatingSystems: Map<string, DailyCount>;
	acceptedLanguages: Map<string, DailyCount>;
}

export async function addDailyStatistics(
	db: WorkerContext['db'],
	visits: VisitFacts[]
): Promise<void> {
	if (visits.length === 0) return;
	await addDailyVisitStatistics(db, groupDailyStatistics(visits));
}

export async function subtractDailyStatistics(
	db: WorkerContext['db'],
	visits: VisitFacts[]
): Promise<DailyStatisticsMismatch[]> {
	if (visits.length === 0) return [];
	return subtractDailyVisitStatistics(db, groupDailyStatistics(visits));
}

export async function warnIfDailyStatisticsMissing(db: WorkerContext['db']): Promise<void> {
	const daily = await db
		.selectFrom('visit_daily_statistics')
		.select('id')
		.limit(1)
		.executeTakeFirst();
	if (daily) return;
	const processed = await db
		.selectFrom('visits')
		.select('id')
		.where('processed', '=', 1)
		.limit(1)
		.executeTakeFirst();
	if (!processed) return;
	logger.warn(
		'visit_daily_statistics is empty while visits contains processed rows. Continuing without rebuilding; daily charts may omit retained visits. Back up the visit database before inspecting processed visits and manually repairing daily statistics, or let retention expire the affected data.'
	);
}

function groupDailyStatistics(visits: VisitFacts[]): DailyVisitStatistics[] {
	const days = new Map<string, DailyAccumulator>();
	for (const visit of visits) {
		const scopes: ReportScope[] = [{ kind: 'overview' }, { kind: 'domain', domain: visit.domain }];
		if (visit.outcome === 'valid') {
			scopes.push({ kind: 'link', domain: visit.domain, path: visit.path });
		}
		for (const scope of scopes) {
			const key = JSON.stringify([scope, visit.day]);
			let day = days.get(key);
			if (!day) {
				day = {
					statistics: emptyDailyStatistics(scope, visit.day),
					browsers: new Map(),
					operatingSystems: new Map(),
					acceptedLanguages: new Map()
				};
				days.set(key, day);
			}
			addVisit(day, visit);
		}
	}
	return [...days.values()].map(({ statistics }) => statistics);
}

function addVisit(day: DailyAccumulator, visit: VisitFacts): void {
	const { statistics } = day;
	const counts =
		visit.outcome === 'valid'
			? { validVisits: 1, invalidVisits: 0 }
			: { validVisits: 0, invalidVisits: 1 };
	statistics.validVisits += counts.validVisits;
	statistics.invalidVisits += counts.invalidVisits;
	statistics.lastVisitAt = Math.max(statistics.lastVisitAt, visit.visitedAt);
	addNamedCounts(statistics.browsers, day.browsers, visit.browser, counts);
	addNamedCounts(statistics.operatingSystems, day.operatingSystems, visit.operatingSystem, counts);
	for (const name of visit.languages) {
		addNamedCounts(statistics.acceptedLanguages, day.acceptedLanguages, name, counts);
	}
}

function addNamedCounts(
	rows: DailyCount[],
	countsByName: Map<string, DailyCount>,
	name: string,
	counts: VisitTotals
): void {
	let row = countsByName.get(name);
	if (!row) {
		row = { name, validVisits: 0, invalidVisits: 0 };
		rows.push(row);
		countsByName.set(name, row);
	}
	row.validVisits += counts.validVisits;
	row.invalidVisits += counts.invalidVisits;
}
