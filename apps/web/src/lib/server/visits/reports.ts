import { createVisitPeriod, type ReportScope, type VisitDetails } from '@goto/analytics';
import type { GotoConfiguration } from '@goto/config';
import { openDb } from '@goto/db';
import {
	readLinkVisitDetails,
	readVisitDetails as readStoredDetails,
	readLastVisitActivity,
	type LinkVisitDetails
} from '@goto/db/visit-reports';
import type { Immutable } from '../snapshot.js';

type ReportConfiguration = Immutable<Pick<GotoConfiguration, 'database' | 'analytics'>>;

export async function readLinkDetails(
	configuration: ReportConfiguration,
	currentLinks: readonly { domain: string; path: string }[]
): Promise<LinkVisitDetails | null> {
	const months = configuration.analytics.retention_months;
	if (months === 0) return null;
	let db: Awaited<ReturnType<typeof openDb>> | undefined;
	try {
		db = await openDb(configuration.database.path, { readOnly: true });
		const period = createVisitPeriod(months, Date.now());
		return await readLinkVisitDetails(db, currentLinks, period);
	} catch {
		warnUnavailable();
		return null;
	} finally {
		await db?.destroy().catch(warnUnavailable);
	}
}

export async function readVisitDetails(
	configuration: ReportConfiguration,
	scope: ReportScope
): Promise<VisitDetails | null> {
	const months = configuration.analytics.retention_months;
	if (months === 0) return null;
	let db: Awaited<ReturnType<typeof openDb>> | undefined;
	try {
		db = await openDb(configuration.database.path, { readOnly: true });
		const period = createVisitPeriod(months, Date.now());
		return await readStoredDetails(db, scope, period);
	} catch {
		warnUnavailable();
		return null;
	} finally {
		await db?.destroy().catch(warnUnavailable);
	}
}

export async function readLastActivity(
	configuration: ReportConfiguration,
	scope: ReportScope = { kind: 'overview' }
): Promise<{ available: boolean; lastActivityAt: string | null }> {
	const months = configuration.analytics.retention_months;
	if (months === 0) return { available: true, lastActivityAt: null };
	let db: Awaited<ReturnType<typeof openDb>> | undefined;
	try {
		db = await openDb(configuration.database.path, { readOnly: true });
		const period = createVisitPeriod(months, Date.now());
		const lastActivityAt = await readLastVisitActivity(db, period, scope);
		return { available: true, lastActivityAt };
	} catch {
		warnUnavailable();
		return { available: false, lastActivityAt: null };
	} finally {
		await db?.destroy().catch(warnUnavailable);
	}
}

function warnUnavailable(): void {
	try {
		console.warn('Prepared visit reports unavailable');
	} catch {
		return;
	}
}
