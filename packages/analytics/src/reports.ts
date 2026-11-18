import { FormatRegistry, Type, type Static } from '@sinclair/typebox';
import { isCanonicalInstant } from './period.js';

const exact = { additionalProperties: false };
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const domain = Type.String({ minLength: 1 });
const path = Type.String({ pattern: '^/' });

FormatRegistry.Set('goto-analytics-utc-instant', isCanonicalInstant);
const instant = Type.String({ format: 'goto-analytics-utc-instant' });
FormatRegistry.Set(
	'goto-analytics-utc-day',
	(value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && isCanonicalInstant(`${value}T00:00:00.000Z`)
);
const day = Type.String({ format: 'goto-analytics-utc-day' });

export const ReportScopeSchema = Type.Union([
	Type.Object({ kind: Type.Literal('overview') }, exact),
	Type.Object({ kind: Type.Literal('domain'), domain }, exact),
	Type.Object({ kind: Type.Literal('link'), domain, path }, exact)
]);
export type ReportScope = Static<typeof ReportScopeSchema>;

export const VisitTotalsSchema = Type.Object({ validVisits: count, invalidVisits: count }, exact);
export type VisitTotals = Static<typeof VisitTotalsSchema>;

export const ReportPeriodSchema = Type.Object(
	{
		from: instant,
		asOf: instant,
		timezone: Type.Literal('UTC'),
		retentionMonths: Type.Union([Type.Literal(3), Type.Literal(9), Type.Literal(12)])
	},
	exact
);
export type ReportPeriod = Static<typeof ReportPeriodSchema>;

const dailyNamedCounts = Type.Object(
	{
		day,
		name: Type.String({ minLength: 1 }),
		validVisits: count,
		invalidVisits: count
	},
	exact
);
export type DailyVisitCountByName = Static<typeof dailyNamedCounts>;

export const VisitDetailsSchema = Type.Object(
	{
		version: Type.Literal(5),
		scope: ReportScopeSchema,
		period: ReportPeriodSchema,
		lastActivityAt: Type.Union([instant, Type.Null()]),
		daily: Type.Array(
			Type.Object(
				{
					start: instant,
					end: instant,
					partial: Type.Boolean(),
					validVisits: count,
					invalidVisits: count
				},
				exact
			)
		),
		browsers: Type.Array(dailyNamedCounts),
		operatingSystems: Type.Array(dailyNamedCounts),
		acceptedLanguages: Type.Array(
			Type.Object(
				{
					...dailyNamedCounts.properties,
					name: Type.String({ pattern: '^(?:[a-z]{2,8}|Other)(?![\\s\\S])' })
				},
				exact
			)
		)
	},
	exact
);
export type VisitDetails = Static<typeof VisitDetailsSchema>;

export function zeroVisitTotals(): VisitTotals {
	return { validVisits: 0, invalidVisits: 0 };
}
