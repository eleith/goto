export {
	addDailyVisitStatistics,
	subtractDailyVisitStatistics,
	deleteExpiredDailyStatistics,
	clearDailyVisitStatistics,
	readOverviewVisitDetails,
	readDomainVisitDetails,
	readLinkVisitDetails,
	readVisitDetails,
	readLastVisitActivity
} from './storage.js';
export type {
	DailyStatisticsMismatch,
	OverviewVisitDetails,
	DomainVisitDetails,
	LinkVisitDetails
} from './storage.js';
