import type { ReportPeriod } from './reports.js';

const daysPerRetentionMonth = 30;
const millisecondsPerDay = 86_400_000;

export function isCanonicalInstant(value: string): boolean {
	const time = Date.parse(value);
	return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function createVisitPeriod(months: 3 | 9 | 12, asOf: number): ReportPeriod {
	if (![3, 9, 12].includes(months) || !Number.isFinite(asOf)) {
		throw new Error('Invalid analytics period');
	}
	const retentionDays = months * daysPerRetentionMonth;
	const end = new Date(asOf);
	const start = new Date(end.getTime() - retentionDays * millisecondsPerDay);
	if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
		throw new Error('Invalid analytics period');
	}
	return {
		from: start.toISOString(),
		asOf: end.toISOString(),
		timezone: 'UTC',
		retentionMonths: months
	};
}

export function visitDays(
	period: ReportPeriod
): Array<{ start: string; end: string; partial: boolean }> {
	const from = Date.parse(period.from);
	const asOf = Date.parse(period.asOf);
	if (!isCanonicalInstant(period.from) || !isCanonicalInstant(period.asOf) || from >= asOf) {
		throw new Error('Invalid analytics period');
	}
	const date = new Date(from);
	date.setUTCHours(0, 0, 0, 0);
	const days = [];
	while (date.getTime() < asOf) {
		const start = date.toISOString();
		const startTime = date.getTime();
		date.setUTCDate(date.getUTCDate() + 1);
		days.push({
			start,
			end: date.toISOString(),
			partial: startTime < from || date.getTime() > asOf
		});
	}
	return days;
}
