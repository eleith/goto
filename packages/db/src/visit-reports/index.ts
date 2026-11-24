export {
	addDailyVisitStatistics,
	subtractDailyVisitStatistics,
	deleteExpiredDailyStatistics,
	clearDailyVisitStatistics,
	readLinkVisitDetails,
	readVisitDetails,
	readAnalyticsVisitDetails,
	readLastVisitActivity
} from './storage.js';
export type {
	AnalyticsVisitDetails,
	DailyStatisticsMismatch,
	LinkVisitDetails
} from './storage.js';
