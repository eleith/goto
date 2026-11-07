import {
	visitDays,
	zeroVisitTotals,
	type DomainSummary,
	type LinkSummary,
	type OverviewSummary,
	type PreparedVisitReport,
	type ReportPeriod,
	type ReportScope,
	type VisitDetails,
	type VisitTotals
} from '@goto/analytics';
import type {
	AggregatedVisitReports,
	DailyVisitCounts,
	ReportInventory,
	ScopedFamilyCounts
} from '@goto/db/visit-reports';

interface ScopeCounts {
	daily: DailyVisitCounts[];
	browsers: ScopedFamilyCounts[];
	operatingSystems: ScopedFamilyCounts[];
}

interface DomainCounts {
	counts: ScopeCounts;
	links: Map<string, ScopeCounts>;
}

interface ReportCounts {
	overview: ScopeCounts;
	domains: Map<string, DomainCounts>;
}

export function buildVisitReports(
	aggregates: AggregatedVisitReports,
	inventory: ReportInventory,
	period: ReportPeriod
): PreparedVisitReport[] {
	const indexed = indexCounts(aggregates);
	const days = visitDays(period);
	const reports: PreparedVisitReport[] = [];
	const domains: OverviewSummary['domains'] = [];

	for (const entry of inventory) {
		const domain = indexed.domains.get(entry.domain);
		const links: DomainSummary['links'] = [];
		const configuredPaths = new Set(entry.paths);
		const allPaths = new Set([...configuredPaths, '/']);
		for (const path of allPaths) {
			const counts = domain?.links.get(path) ?? emptyCounts();
			const scope = { kind: 'link' as const, domain: entry.domain, path };
			const summary = buildLinkSummary(scope, counts, period);
			if (configuredPaths.has(path)) links.push({ path, totals: summary.totals });
			reports.push({ summary, details: buildDetails(scope, counts, period, days) });
		}
		const scope = { kind: 'domain' as const, domain: entry.domain };
		const counts = domain?.counts ?? emptyCounts();
		const summary = buildDomainSummary(scope, counts, links, period);
		domains.push({ domain: entry.domain, totals: summary.totals });
		reports.push({ summary, details: buildDetails(scope, counts, period, days) });
	}

	const summary = buildOverviewSummary(indexed.overview, domains, period);
	reports.push({
		summary,
		details: buildDetails(summary.scope, indexed.overview, period, days)
	});
	return reports;
}

function indexCounts(aggregates: AggregatedVisitReports): ReportCounts {
	const indexed: ReportCounts = { overview: emptyCounts(), domains: new Map() };
	for (const row of aggregates.daily) countsForScope(indexed, row).daily.push(row);
	for (const row of aggregates.browsers) countsForScope(indexed, row).browsers.push(row);
	for (const row of aggregates.operatingSystems)
		countsForScope(indexed, row).operatingSystems.push(row);
	return indexed;
}

function countsForScope(
	indexed: ReportCounts,
	scope: DailyVisitCounts | ScopedFamilyCounts
): ScopeCounts {
	if (scope.scopeKind === 'overview') return indexed.overview;
	let domain = indexed.domains.get(scope.domain);
	if (!domain) {
		domain = { counts: emptyCounts(), links: new Map() };
		indexed.domains.set(scope.domain, domain);
	}
	if (scope.scopeKind === 'domain') return domain.counts;
	let link = domain.links.get(scope.path);
	if (!link) {
		link = emptyCounts();
		domain.links.set(scope.path, link);
	}
	return link;
}

function emptyCounts(): ScopeCounts {
	return { daily: [], browsers: [], operatingSystems: [] };
}

function buildOverviewSummary(
	counts: ScopeCounts,
	domains: OverviewSummary['domains'],
	period: ReportPeriod
): OverviewSummary {
	return {
		version: 1,
		scope: { kind: 'overview' },
		period,
		...summarizeDaily(counts.daily),
		domains
	};
}

function buildDomainSummary(
	scope: DomainSummary['scope'],
	counts: ScopeCounts,
	links: DomainSummary['links'],
	period: ReportPeriod
): DomainSummary {
	return { version: 1, scope, period, ...summarizeDaily(counts.daily), links };
}

function buildLinkSummary(
	scope: LinkSummary['scope'],
	counts: ScopeCounts,
	period: ReportPeriod
): LinkSummary {
	const { totals } = summarizeDaily(counts.daily);
	return { version: 1, scope, period, totals };
}

function summarizeDaily(rows: DailyVisitCounts[]): { totals: VisitTotals; base: VisitTotals } {
	const totals = zeroVisitTotals();
	const base = zeroVisitTotals();
	for (const row of rows) {
		totals.validVisits += row.validVisits;
		totals.invalidVisits += row.invalidVisits;
		base.validVisits += row.baseValidVisits;
		base.invalidVisits += row.baseInvalidVisits;
	}
	return { totals, base };
}

function buildDetails(
	scope: ReportScope,
	counts: ScopeCounts,
	period: ReportPeriod,
	days: ReturnType<typeof visitDays>
): VisitDetails {
	return {
		version: 1,
		scope,
		period,
		daily: buildDailyDetails(counts.daily, days),
		browsers: buildFamilyDetails(counts.browsers),
		operatingSystems: buildFamilyDetails(counts.operatingSystems)
	};
}

function buildDailyDetails(
	rows: DailyVisitCounts[],
	days: ReturnType<typeof visitDays>
): VisitDetails['daily'] {
	const countsByDay = new Map(rows.map((row) => [row.day, row]));
	return days.map((day) => {
		const counts = countsByDay.get(day.start.slice(0, 10));
		return {
			...day,
			validVisits: counts?.validVisits ?? 0,
			invalidVisits: counts?.invalidVisits ?? 0
		};
	});
}

function buildFamilyDetails(rows: ScopedFamilyCounts[]): VisitDetails['browsers'] {
	return rows.map(({ family, validVisits, invalidVisits }) => ({
		family,
		validVisits,
		invalidVisits
	}));
}
