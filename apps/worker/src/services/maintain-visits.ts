import { setImmediate } from 'node:timers/promises';
import { createVisitPeriod, type ReportScope, type VisitTotals } from '@goto/analytics';
import {
	addVisitTotals,
	captureVisitBoundary,
	processVisitBatch,
	deleteExpiredVisitBatch,
	deleteProcessedVisitBatch,
	type Visit
} from '@goto/db';
import {
	clearDailyVisitStatistics,
	deleteExpiredDailyStatistics,
	type DailyStatisticsMismatch
} from '@goto/db/visit-reports';
import type { WorkerContext } from './context.js';
import { getVisitFacts } from './visit-facts.js';
import { addDailyStatistics, subtractDailyStatistics } from './update-daily-statistics.js';
import { logger } from './logger.js';

interface Maintenance {
	context: WorkerContext;
	months: number;
	asOf: number;
	throughId: number;
}

export async function maintainVisits(context: WorkerContext, asOf = Date.now()): Promise<void> {
	const months = context.config.analytics.retention_months;
	const throughId = await captureVisitBoundary(context.db);
	const maintenance = { context, months, asOf, throughId };
	if (!policyUnchanged(maintenance)) return;
	await processPendingVisits(maintenance);
	if (!policyUnchanged(maintenance)) return;
	if (months === 0) {
		await clearDailyVisitStatistics(context.db);
		await deleteProcessedVisits(maintenance);
		return;
	}
	const period = createVisitPeriod(months, asOf);
	const before = Date.parse(period.from);
	await deleteExpiredVisits(maintenance, before);
	if (policyUnchanged(maintenance)) {
		await deleteExpiredDailyStatistics(context.db, before);
	}
}

async function processPendingVisits(maintenance: Maintenance): Promise<void> {
	const { context, throughId, asOf } = maintenance;
	async function applyStatistics(db: WorkerContext['db'], visits: Visit[]): Promise<void> {
		await addBatchVisitTotals(db, visits);
		if (maintenance.months > 0) await addDailyStatistics(db, visits.map(getVisitFacts));
	}
	while (policyUnchanged(maintenance)) {
		const more = await processVisitBatch(context.db, { throughId, asOf }, applyStatistics);
		await setImmediate();
		if (!more) return;
	}
}

async function addBatchVisitTotals(
	db: WorkerContext['db'],
	visits: readonly Visit[]
): Promise<void> {
	const additions = new Map<string, { scope: ReportScope; totals: VisitTotals }>();
	for (const visit of visits) {
		const outcome = visit.path === '/' ? 'valid' : visit.outcome;
		const scopes: ReportScope[] = [{ kind: 'overview' }, { kind: 'domain', domain: visit.domain }];
		if (outcome === 'valid') {
			scopes.push({ kind: 'link', domain: visit.domain, path: visit.path });
		}
		for (const scope of scopes) {
			const key = JSON.stringify(scope);
			let addition = additions.get(key);
			if (!addition) {
				addition = { scope, totals: { validVisits: 0, invalidVisits: 0 } };
				additions.set(key, addition);
			}
			if (outcome === 'valid') addition.totals.validVisits++;
			else addition.totals.invalidVisits++;
		}
	}
	await addVisitTotals(db, [...additions.values()]);
}

async function deleteProcessedVisits(maintenance: Maintenance): Promise<void> {
	const { context, throughId } = maintenance;
	while (policyUnchanged(maintenance)) {
		const more = await deleteProcessedVisitBatch(context.db, throughId);
		await setImmediate();
		if (!more) return;
	}
}

async function deleteExpiredVisits(maintenance: Maintenance, before: number): Promise<void> {
	const { context, throughId } = maintenance;
	let batchMismatches: DailyStatisticsMismatch[];
	let skippedBucketUpdates = 0;
	const examples: DailyStatisticsMismatch[] = [];
	async function removeStatistics(db: WorkerContext['db'], visits: Visit[]): Promise<void> {
		batchMismatches = await subtractDailyStatistics(db, visits.map(getVisitFacts));
	}
	try {
		while (policyUnchanged(maintenance)) {
			batchMismatches = [];
			const more = await deleteExpiredVisitBatch(
				context.db,
				{ throughId, before },
				removeStatistics
			);
			skippedBucketUpdates += batchMismatches.length;
			examples.push(...batchMismatches.slice(0, 5 - examples.length));
			await setImmediate();
			if (!more) return;
		}
	} finally {
		if (skippedBucketUpdates > 0) {
			logger.warn(
				{ table: 'visit_daily_statistics', skippedBucketUpdates, examples },
				'Expired processed visits were deleted despite missing or inconsistent daily statistics. Subtraction was skipped for the affected buckets; other buckets were updated normally. Daily charts may be inaccurate until the affected data expires. Up to five scope/day examples include the row ID, stored totals and attempted removal. Back up the visit database before inspecting those rows and their breakdown JSON for manual correction, or let retention remove them. No rebuild or bucket reset was performed.'
			);
		}
	}
}

function policyUnchanged({ context, months }: Maintenance): boolean {
	return context.config.analytics.retention_months === months;
}
