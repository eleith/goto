import { countBreakdownVisitsByTimeframe } from '@goto/analytics';
import { availableVisitTimeframes, countVisitWindows, visitWindow } from '@goto/analytics/daily';
import { redirect } from '@sveltejs/kit';
import { readVisitDetails } from '#lib/server/visits/reports.js';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals }) => {
	const { configuration } = locals.snapshot;
	const retentionMonths = configuration.analytics.retention_months;
	if (retentionMonths === 0) redirect(307, '/admin/health');

	const timeframes = availableVisitTimeframes(retentionMonths);
	const details = await readVisitDetails(configuration, { kind: 'overview' });
	if (!details) return { retentionMonths, timeframes, report: null };

	const windows = timeframes.map((timeframe) => ({
		timeframe,
		window: visitWindow(details.period, timeframe)
	}));
	return {
		retentionMonths,
		timeframes,
		report: {
			period: details.period,
			daily: details.daily,
			lastActivityAt: details.lastActivityAt ? Date.parse(details.lastActivityAt) : null,
			countsByTimeframe: countVisitWindows(details.daily, windows),
			browserVisitsByTimeframe: countBreakdownVisitsByTimeframe(details.browsers, windows),
			operatingSystemVisitsByTimeframe: countBreakdownVisitsByTimeframe(
				details.operatingSystems,
				windows
			),
			acceptedLanguageVisitsByTimeframe: countBreakdownVisitsByTimeframe(
				details.acceptedLanguages,
				windows
			)
		}
	};
}) satisfies PageServerLoad;
