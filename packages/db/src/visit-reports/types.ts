import type { VisitTotals } from '@goto/analytics';

export type ReportInventory = Array<{ domain: string; paths: string[] }>;

type DiscriminatedAggregateScope =
	| { scopeKind: 'overview'; domain: null; path: null }
	| { scopeKind: 'domain'; domain: string; path: null }
	| { scopeKind: 'link'; domain: string; path: string };

export type DailyVisitCounts = DiscriminatedAggregateScope &
	VisitTotals & {
		day: string;
		baseValidVisits: number;
		baseInvalidVisits: number;
	};

export type DailyBrowserOsCounts = DiscriminatedAggregateScope &
	VisitTotals & { day: string; name: string };

export interface AggregatedVisitReports {
	daily: DailyVisitCounts[];
	browsers: DailyBrowserOsCounts[];
	operatingSystems: DailyBrowserOsCounts[];
}
