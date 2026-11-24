<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolveVisitTimeframe, visitGranularity, visitWindow } from '@goto/analytics/daily';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import VisitBreakdowns from '#lib/components/admin/VisitBreakdowns.svelte';
	import VisitsChart from '#lib/components/admin/VisitsChart.svelte';
	import VisitTimeframes from '#lib/components/admin/VisitTimeframes.svelte';
	import { setScope, type AnalyticsScope } from '#lib/report-scopes.js';
	import ReportScopePicker from './ReportScopePicker.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let report = $derived(data.report);
	let currentUrl = $derived(page.shallow?.url ?? page.url);
	let timeframe = $derived(
		resolveVisitTimeframe(data.timeframes, currentUrl.searchParams.get('period'))
	);
	let counts = $derived(report?.countsByTimeframe[timeframe]);
	let isRootReport = $derived(data.scope.kind === 'link' && data.scope.path === '/');

	let selectionNavigationFailed = $state(false);
	let pendingReportNavigations = $state(0);

	async function selectScope(scope: AnalyticsScope): Promise<void> {
		selectionNavigationFailed = false;
		const committedUrl = currentUrl.href;
		const next = new URL(committedUrl);
		setScope(next.searchParams, scope);
		pendingReportNavigations += 1;
		try {
			await goto(next, { reset: false });
		} catch {
			if (currentUrl.href === committedUrl) selectionNavigationFailed = true;
		} finally {
			pendingReportNavigations -= 1;
		}
	}
</script>

<AdminPage title="Analytics" analyticsEnabled lastActivityAt={report?.lastActivityAt ?? null}>
	{#snippet actions()}
		{#if report}
			<VisitTimeframes
				timeframes={data.timeframes}
				retentionMonths={data.retentionMonths}
				value={timeframe}
			/>
		{/if}
	{/snippet}
	<div class="analytics-summary" class:has-root-count={report?.rootVisitsByTimeframe != null}>
		<div
			class="report-filters"
			role="group"
			aria-label="Report filters"
			aria-busy={pendingReportNavigations > 0}
		>
			<ReportScopePicker
				groups={data.groups}
				committedScope={data.scope}
				onSelectionRequest={selectScope}
			/>
		</div>
		{#if counts}
			<div class="admin-cards report-totals">
				{#if isRootReport}
					<StatCard label="Root visits" value={counts.validVisits} />
				{:else}
					<StatCard label="Visits" value={counts.validVisits} />
					<StatCard label="Invalid clicks" value={counts.invalidVisits} />
					{#if report?.rootVisitsByTimeframe}
						<StatCard label="Root visits" value={report.rootVisitsByTimeframe[timeframe] ?? 0} />
					{/if}
				{/if}
			</div>
		{/if}
	</div>
	{#if selectionNavigationFailed}
		<p class="admin-notice" role="alert">Could not change the report selection. Try again.</p>
	{/if}
	{#if data.scopeUnavailable}
		<p class="admin-notice" role="status">
			This report scope is no longer configured. Choose another scope or select All traffic.
		</p>
	{:else}
		<ReportNotice collectionEnabled available={report !== null} />
	{/if}
	{#if report && counts}
		<VisitsChart
			daily={report.daily}
			window={visitWindow(report.period, timeframe)}
			granularity={visitGranularity(timeframe, report.period.retentionMonths)}
			visitLabel={isRootReport ? 'Root visits' : 'Visits'}
		/>
		<VisitBreakdowns
			browserVisits={report.browserVisitsByTimeframe[timeframe] ?? []}
			operatingSystemVisits={report.operatingSystemVisitsByTimeframe[timeframe] ?? []}
			acceptedLanguageVisits={report.acceptedLanguageVisitsByTimeframe[timeframe] ?? []}
			totalVisits={counts.validVisits}
		/>
	{/if}
</AdminPage>

<style>
	.analytics-summary {
		--summary-card-width: 12rem;
		--summary-pair-width: calc(2 * var(--summary-card-width) + var(--space-5));
		display: grid;
		grid-template-columns: minmax(0, var(--summary-pair-width));
		gap: var(--space-5);
		align-items: start;
	}

	.report-filters {
		min-width: 0;
	}

	.report-totals {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	@media (width <= 400px) {
		.analytics-summary {
			grid-template-columns: minmax(0, var(--summary-card-width));
		}

		.report-totals {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (width > 900px) {
		.analytics-summary.has-root-count {
			--summary-trio-width: calc(3 * var(--summary-card-width) + 2 * var(--space-5));
			grid-template-columns: minmax(0, var(--summary-pair-width)) minmax(
					0,
					var(--summary-trio-width)
				);
		}

		.has-root-count .report-totals {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (width > 640px) {
		.analytics-summary {
			grid-template-columns: repeat(2, minmax(0, var(--summary-pair-width)));
			justify-content: space-between;
		}

		.report-filters {
			align-self: center;
		}
	}
</style>
