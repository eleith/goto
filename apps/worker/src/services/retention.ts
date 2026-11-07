import type { GotoConfiguration } from '@goto/config';

export type RetentionMonths = GotoConfiguration['analytics']['retention_months'];

export function retentionCutoff(months: Exclude<RetentionMonths, 0>, now = Date.now()): number {
	const cutoff = new Date(now);
	const day = cutoff.getUTCDate();
	cutoff.setUTCDate(1);
	cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
	const lastDay = new Date(
		Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)
	).getUTCDate();
	cutoff.setUTCDate(Math.min(day, lastDay));
	return cutoff.getTime();
}
