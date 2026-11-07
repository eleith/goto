import {
	visitReportKey,
	zeroVisitCounts,
	type AggregatedVisitReports,
	type DailyVisitCounts,
	type ScopedFamilyCounts,
	type PreparedVisitReport,
	type ReportInventory,
	type SerializedVisitReport,
	type VisitCounts,
	type VisitReportPeriod
} from '@goto/db/visit-reports';

interface ScopeCounts {
	daily: DailyVisitCounts[];
	browsers: ScopedFamilyCounts[];
	operatingSystems: ScopedFamilyCounts[];
}

export function buildVisitReports(
	aggregates: AggregatedVisitReports,
	inventory: ReportInventory,
	period: VisitReportPeriod
): SerializedVisitReport[] {
	const indexed = indexCounts(aggregates);
	const empty = emptyReport(period);
	const reports: SerializedVisitReport[] = [{ key: 'empty', data: JSON.stringify(empty) }];
	const linkTotals = new Map<string, VisitCounts>();
	const domainTotals = new Map<string, VisitCounts>();

	for (const entry of inventory) {
		const paths = [...new Set([...entry.paths, '/'])];
		for (const path of paths) {
			const key = visitReportKey(entry.domain, path);
			const source = indexed.get(key);
			if (!source) {
				linkTotals.set(key, zeroVisitCounts());
				continue;
			}
			const report = scopeReport(source, period);
			linkTotals.set(key, report.totals);
			reports.push({ key, data: JSON.stringify(report) });
		}
		const key = visitReportKey(entry.domain);
		const source = indexed.get(key);
		const report = source ? scopeReport(source, period) : { ...empty };
		report.linkCounts = paths.map((path) => {
			const linkKey = visitReportKey(entry.domain, path);
			return { path, counts: linkTotals.get(linkKey) ?? zeroVisitCounts() };
		});
		domainTotals.set(entry.domain, report.totals);
		reports.push({ key, data: JSON.stringify(report) });
	}
	const overviewSource = indexed.get('overview');
	const overview = overviewSource ? scopeReport(overviewSource, period) : { ...empty };
	overview.domainCounts = inventory.map((entry) => ({
		domain: entry.domain,
		counts: domainTotals.get(entry.domain) ?? zeroVisitCounts()
	}));
	reports.push({ key: 'overview', data: JSON.stringify(overview) });
	return reports;
}

function indexCounts(aggregates: AggregatedVisitReports): Map<string, ScopeCounts> {
	const indexed = new Map<string, ScopeCounts>();
	function scope(key: string): ScopeCounts {
		let counts = indexed.get(key);
		if (!counts) {
			counts = { daily: [], browsers: [], operatingSystems: [] };
			indexed.set(key, counts);
		}
		return counts;
	}
	for (const row of aggregates.daily) scope(row.scope).daily.push(row);
	for (const row of aggregates.browsers) scope(row.scope).browsers.push(row);
	for (const row of aggregates.operatingSystems) scope(row.scope).operatingSystems.push(row);
	return indexed;
}

function emptyReport(period: VisitReportPeriod): PreparedVisitReport {
	return {
		totals: zeroVisitCounts(),
		daily: period.days.map(() => zeroVisitCounts()),
		weekly: period.weeks.map(() => zeroVisitCounts()),
		monthly: period.months.map(() => zeroVisitCounts()),
		browsers: [],
		operatingSystems: [],
		domainCounts: [],
		linkCounts: []
	};
}

function scopeReport(source: ScopeCounts, period: VisitReportPeriod): PreparedVisitReport {
	const report = emptyReport(period);
	const dayIndexes = new Map<number, number>();
	period.days.forEach((bucket, index) => dayIndexes.set(bucket.start, index));
	for (const row of source.daily) {
		const start = Date.parse(`${row.day}T00:00:00Z`);
		const index = dayIndexes.get(start);
		if (index === undefined) continue;
		addCounts(report.daily[index]!, row);
		addCounts(report.totals, row);
	}
	for (let index = 0; index < period.days.length; index++) {
		const day = period.days[index]!;
		const counts = report.daily[index]!;
		const week = period.weeks.findIndex(
			(bucket) => day.start >= bucket.start && day.start < bucket.end
		);
		const month = period.months.findIndex(
			(bucket) => day.start >= bucket.start && day.start < bucket.end
		);
		if (week >= 0) addCounts(report.weekly[week]!, counts);
		if (month >= 0) addCounts(report.monthly[month]!, counts);
	}
	report.browsers = source.browsers.map((row) => ({ name: row.name, counts: copyCounts(row) }));
	report.operatingSystems = source.operatingSystems.map((row) => ({
		name: row.name,
		counts: copyCounts(row)
	}));
	return report;
}

function copyCounts(counts: VisitCounts): VisitCounts {
	return { total: counts.total, valid: counts.valid, invalid: counts.invalid, base: counts.base };
}

function addCounts(target: VisitCounts, counts: VisitCounts): void {
	target.total += counts.total;
	target.valid += counts.valid;
	target.invalid += counts.invalid;
	target.base += counts.base;
}
