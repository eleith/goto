<script lang="ts">
	import { page } from '$app/state';
	import { resolveVisitTimeframe, visitGranularity, visitWindow } from '@goto/analytics/daily';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import AnalyticsSection from '#lib/components/admin/AnalyticsSection.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import VisitBreakdowns from '#lib/components/admin/VisitBreakdowns.svelte';
	import VisitsChart from '#lib/components/admin/VisitsChart.svelte';
	import VisitTimeframes from '#lib/components/admin/VisitTimeframes.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let report = $derived(data.report);
	let currentUrl = $derived(page.shallow?.url ?? page.url);
	let timeframe = $derived(
		resolveVisitTimeframe(data.timeframes, currentUrl.searchParams.get('period'))
	);
	let counts = $derived(report?.countsByTimeframe[timeframe]);
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
	<AnalyticsSection heading="All domains">
		<ReportNotice collectionEnabled available={report !== null} />
		{#if report && counts}
			<div class="admin-cards">
				<StatCard label="Visits" value={counts.validVisits} />
				<StatCard label="Invalid clicks" value={counts.invalidVisits} />
			</div>
			<VisitsChart
				daily={report.daily}
				window={visitWindow(report.period, timeframe)}
				granularity={visitGranularity(timeframe, report.period.retentionMonths)}
			/>
			<VisitBreakdowns
				browserVisits={report.browserVisitsByTimeframe[timeframe] ?? []}
				operatingSystemVisits={report.operatingSystemVisitsByTimeframe[timeframe] ?? []}
				acceptedLanguageVisits={report.acceptedLanguageVisitsByTimeframe[timeframe] ?? []}
				totalVisits={counts.validVisits}
			/>
		{/if}
	</AnalyticsSection>
</AdminPage>
