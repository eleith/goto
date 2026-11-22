export {
	addDailyVisitStatistics,
	subtractDailyVisitStatistics,
	deleteExpiredDailyStatistics,
	clearDailyVisitStatistics,
	readLinkVisitDetails,
	readVisitDetails,
	readLastVisitActivity
} from './storage.js';
export type { DailyStatisticsMismatch, LinkVisitDetails } from './storage.js';
