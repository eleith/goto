<script lang="ts">
	import { page } from '$app/state';
	import { resolveVisitTimeframe, visitGranularity, visitWindow } from '@goto/analytics/daily';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import AnalyticsSection from '#lib/components/admin/AnalyticsSection.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import VisitBreakdowns from '#lib/components/admin/VisitBreakdowns.svelte';
	import VisitsChart from '#lib/components/admin/VisitsChart.svelte';
	import VisitTimeframes from '#lib/components/admin/VisitTimeframes.svelte';
	import LinkInventory from '#lib/components/admin/LinkInventory.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	let currentUrl = $derived(page.shallow?.url ?? page.url);
	let timeframe = $derived(
		resolveVisitTimeframe(data.timeframes, currentUrl.searchParams.get('period'))
	);
	let window = $derived(data.chart ? visitWindow(data.chart.period, timeframe) : null);
	let granularity = $derived(
		data.chart ? visitGranularity(timeframe, data.chart.period.retentionMonths) : 'day'
	);
	let visits = $derived(data.countsByTimeframe[timeframe]?.validVisits ?? null);
	let invalidClicks = $derived(data.countsByTimeframe[timeframe]?.invalidVisits ?? null);
	let browserVisits = $derived(data.browserVisitsByTimeframe[timeframe] ?? null);
	let operatingSystemVisits = $derived(data.operatingSystemVisitsByTimeframe[timeframe] ?? null);
	let acceptedLanguageVisits = $derived(data.acceptedLanguageVisitsByTimeframe[timeframe] ?? null);
</script>

<AdminPage
	siteTitle={data.title}
	title={`Tag: ${data.tag}`}
	lastActivityAt={data.lastActivityAt}
	overviewHref={`/admin?period=${timeframe}`}
>
	{#snippet actions()}
		{#if data.available && data.timeframes.length > 0}
			<VisitTimeframes
				timeframes={data.timeframes}
				retentionMonths={data.retentionMonths}
				value={timeframe}
			/>
		{/if}
	{/snippet}
	<section>
		<h2>Links</h2>
		<LinkInventory
			label={`Links tagged ${data.tag}`}
			links={data.links}
			{timeframe}
			collectionEnabled={data.collectionEnabled}
			showDomain
		/>
	</section>
	<AnalyticsSection>
		<ReportNotice collectionEnabled={data.collectionEnabled} available={data.available} />
		<div class="admin-cards">
			<StatCard label="Links" value={data.linkCount} />
			{#if data.collectionEnabled}
				<StatCard label="Visits" value={visits} />
				<StatCard label="Invalid clicks" value={invalidClicks} />
			{/if}
		</div>
		{#if data.chart && window}
			<VisitsChart daily={data.chart.daily} {window} {granularity} />
		{/if}
		{#if browserVisits && operatingSystemVisits && acceptedLanguageVisits && visits !== null}
			<VisitBreakdowns
				{browserVisits}
				{operatingSystemVisits}
				{acceptedLanguageVisits}
				totalVisits={visits}
			/>
		{/if}
	</AnalyticsSection>
</AdminPage>
