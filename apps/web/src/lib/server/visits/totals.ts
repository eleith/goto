import type { ReportScope, VisitTotals } from '@goto/analytics';
import type { GotoConfiguration } from '@goto/config';
import {
	openDb,
	readDomainLifetimeVisitTotals as queryDomainLifetimeVisitTotals,
	readOverviewLifetimeVisitTotals as queryOverviewLifetimeVisitTotals,
	readLifetimeVisitTotals as queryLifetimeVisitTotals
} from '@goto/db';
import type { Immutable } from '../snapshot.js';

type VisitTotalsConfiguration = Immutable<Pick<GotoConfiguration, 'database'>>;

export function readLifetimeVisitTotals(
	configuration: VisitTotalsConfiguration,
	scope: ReportScope
): Promise<VisitTotals | null> {
	return readPreparedTotals(configuration, (db) => queryLifetimeVisitTotals(db, scope));
}

export function readOverviewLifetimeVisitTotals(
	configuration: VisitTotalsConfiguration,
	domains: readonly string[]
) {
	return readPreparedTotals(configuration, (db) => queryOverviewLifetimeVisitTotals(db, domains));
}

export function readDomainLifetimeVisitTotals(
	configuration: VisitTotalsConfiguration,
	domain: string,
	paths: readonly string[]
) {
	return readPreparedTotals(configuration, (db) =>
		queryDomainLifetimeVisitTotals(db, domain, paths)
	);
}

async function readPreparedTotals<T>(
	configuration: VisitTotalsConfiguration,
	read: (db: Awaited<ReturnType<typeof openDb>>) => Promise<T>
): Promise<T | null> {
	let db: Awaited<ReturnType<typeof openDb>> | undefined;
	try {
		db = await openDb(configuration.database.path, { readOnly: true });
		return await read(db);
	} catch {
		warnUnavailable();
		return null;
	} finally {
		await db?.destroy().catch(warnUnavailable);
	}
}

function warnUnavailable(): void {
	try {
		console.warn('Prepared lifetime visit totals unavailable');
	} catch {
		return;
	}
}
