import type { ReportScope, VisitDetails } from '@goto/analytics';
import type { GotoConfiguration } from '@goto/config';
import { openDb } from '@goto/db';
import {
	readOverviewVisitDetails,
	readDomainVisitDetails,
	readLinkVisitDetails,
	readVisitDetails as readPreparedDetails,
	type OverviewVisitDetails,
	type DomainVisitDetails,
	type LinkVisitDetails
} from '@goto/db/visit-reports';
import type { Immutable } from '../snapshot.js';

type ReportConfiguration = Immutable<Pick<GotoConfiguration, 'database' | 'analytics'>>;

export async function readOverviewDetails(
	configuration: ReportConfiguration,
	currentDomains: string[]
): Promise<OverviewVisitDetails | null> {
	const months = configuration.analytics.retention_months;
	if (months === 0) return null;
	let db: Awaited<ReturnType<typeof openDb>> | undefined;
	try {
		db = await openDb(configuration.database.path, { readOnly: true });
		const report = await readOverviewVisitDetails(db, currentDomains);
		if (!report || report.overview.period.retentionMonths !== months) return null;
		return report;
	} catch {
		warnUnavailable();
		return null;
	} finally {
		await db?.destroy().catch(warnUnavailable);
	}
}

export async function readDomainDetails(
	configuration: ReportConfiguration,
	domain: string,
	currentPaths: string[]
): Promise<DomainVisitDetails | null> {
	const months = configuration.analytics.retention_months;
	if (months === 0) return null;
	let db: Awaited<ReturnType<typeof openDb>> | undefined;
	try {
		db = await openDb(configuration.database.path, { readOnly: true });
		const report = await readDomainVisitDetails(db, domain, currentPaths);
		if (!report || report.domain.period.retentionMonths !== months) return null;
		return report;
	} catch {
		warnUnavailable();
		return null;
	} finally {
		await db?.destroy().catch(warnUnavailable);
	}
}

export async function readLinkDetails(
	configuration: ReportConfiguration,
	currentLinks: readonly { domain: string; path: string }[]
): Promise<LinkVisitDetails | null> {
	const months = configuration.analytics.retention_months;
	if (months === 0) return null;
	let db: Awaited<ReturnType<typeof openDb>> | undefined;
	try {
		db = await openDb(configuration.database.path, { readOnly: true });
		const report = await readLinkVisitDetails(db, currentLinks);
		if (!report || report.period.retentionMonths !== months) return null;
		return report;
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
		const details = await readPreparedDetails(db, scope);
		if (!details || details.period.retentionMonths !== months) return null;
		return details;
	} catch {
		warnUnavailable();
		return null;
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
