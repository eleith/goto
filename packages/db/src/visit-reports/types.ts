export interface VisitCounts {
	total: number;
	valid: number;
	invalid: number;
	base: number;
}

export function zeroVisitCounts(): VisitCounts {
	return { total: 0, valid: 0, invalid: 0, base: 0 };
}

export interface TimeBucket {
	start: number;
	end: number;
	partial: boolean;
}

export interface VisitReportPeriod {
	timezone: 'UTC';
	retentionMonths: 3 | 9 | 12;
	since: number;
	asOf: number;
	days: TimeBucket[];
	weeks: TimeBucket[];
	months: TimeBucket[];
}

export interface FamilyVisitCounts {
	name: string;
	counts: VisitCounts;
}

export interface PreparedVisitReport {
	totals: VisitCounts;
	daily: VisitCounts[];
	weekly: VisitCounts[];
	monthly: VisitCounts[];
	browsers: FamilyVisitCounts[];
	operatingSystems: FamilyVisitCounts[];
	domainCounts: Array<{ domain: string; counts: VisitCounts }>;
	linkCounts: Array<{ path: string; counts: VisitCounts }>;
}

export type ReportInventory = Array<{ domain: string; paths: string[] }>;

export function visitReportKey(domain?: string, path?: string): string {
	if (domain === undefined) return 'overview';
	return JSON.stringify(path === undefined ? [domain] : [domain, path]);
}

export interface SerializedVisitReport {
	key: string;
	data: string;
}

export interface StoredVisitReports {
	period: VisitReportPeriod;
	report: PreparedVisitReport;
	selection: PreparedVisitReport;
}

export interface DailyVisitCounts extends VisitCounts {
	scope: string;
	day: string;
}

export interface ScopedFamilyCounts extends VisitCounts {
	scope: string;
	name: string;
}

export interface AggregatedVisitReports {
	daily: DailyVisitCounts[];
	browsers: ScopedFamilyCounts[];
	operatingSystems: ScopedFamilyCounts[];
}
