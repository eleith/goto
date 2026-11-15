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

const headers = {
	version: Type.Literal(1),
	period: ReportPeriodSchema,
	totals: VisitTotalsSchema
};

export const OverviewSummarySchema = Type.Object(
	{
		...headers,
		scope: Type.Object({ kind: Type.Literal('overview') }, exact),
		base: VisitTotalsSchema,
		domains: Type.Array(Type.Object({ domain, totals: VisitTotalsSchema }, exact))
	},
	exact
);
export type OverviewSummary = Static<typeof OverviewSummarySchema>;

export const DomainSummarySchema = Type.Object(
	{
		...headers,
		scope: Type.Object({ kind: Type.Literal('domain'), domain }, exact),
		base: VisitTotalsSchema,
		links: Type.Array(Type.Object({ path, totals: VisitTotalsSchema }, exact))
	},
	exact
);
export type DomainSummary = Static<typeof DomainSummarySchema>;

export const LinkSummarySchema = Type.Object(
	{
		...headers,
		scope: Type.Object({ kind: Type.Literal('link'), domain, path }, exact)
	},
	exact
);
export type LinkSummary = Static<typeof LinkSummarySchema>;

export const VisitSummarySchema = Type.Union([
	OverviewSummarySchema,
	DomainSummarySchema,
	LinkSummarySchema
]);
export type VisitSummary = Static<typeof VisitSummarySchema>;

const dailyNamedCounts = Type.Object(
	{
		day,
		name: Type.String({ minLength: 1 }),
		validVisits: count,
		invalidVisits: count
	},
	exact
);

export const VisitDetailsSchema = Type.Object(
	{
		version: Type.Literal(4),
		scope: ReportScopeSchema,
		period: ReportPeriodSchema,
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

export interface PreparedVisitReport {
	summary: VisitSummary;
	details: VisitDetails;
}

export interface SerializedVisitReport {
	scope: ReportScope;
	summaryJson: string;
	detailsJson: string;
}

export function zeroVisitTotals(): VisitTotals {
	return { validVisits: 0, invalidVisits: 0 };
}
