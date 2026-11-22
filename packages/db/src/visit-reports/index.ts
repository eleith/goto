export {
	addDailyVisitStatistics,
	subtractDailyVisitStatistics,
	deleteExpiredDailyStatistics,
	clearDailyVisitStatistics,
	readDomainVisitDetails,
	readLinkVisitDetails,
	readVisitDetails,
	readLastVisitActivity
} from './storage.js';
export type { DailyStatisticsMismatch, DomainVisitDetails, LinkVisitDetails } from './storage.js';
