import type { ReportPeriod } from './reports.js';

export function isCanonicalInstant(value: string): boolean {
	const time = Date.parse(value);
	return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function createVisitPeriod(months: 3 | 9 | 12, asOf: number): ReportPeriod {
	if (![3, 9, 12].includes(months) || !Number.isFinite(asOf)) {
		throw new Error('Invalid analytics period');
	}
	const end = new Date(asOf);
	const start = new Date(asOf);
	const day = start.getUTCDate();
	start.setUTCDate(1);
	start.setUTCMonth(start.getUTCMonth() - months);
	const lastDay = new Date(start);
	lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
	lastDay.setUTCDate(0);
	start.setUTCDate(Math.min(day, lastDay.getUTCDate()));
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
