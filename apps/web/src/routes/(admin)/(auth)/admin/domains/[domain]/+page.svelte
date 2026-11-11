<script lang="ts">
	import { page } from '$app/state';
	import { resolveVisitTimeframe, visitGranularity, visitWindow } from '@goto/analytics/daily';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import VisitsChart from '#lib/components/admin/VisitsChart.svelte';
	import VisitTimeframes from '#lib/components/admin/VisitTimeframes.svelte';
	import LinkInventory from '#lib/components/admin/LinkInventory.svelte';
	import { formatRetention } from '#lib/components/admin/format.js';
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
	let validVisits = $derived(data.countsByTimeframe[timeframe]?.validVisits ?? null);
	let invalidClicks = $derived(data.invalidClicksByTimeframe[timeframe] ?? null);
	let baseLinks = $derived([{ path: '/', ...data.base }]);
</script>

<AdminPage
	siteTitle={data.title}
	title="Domain"
	documentTitle={`Domain — ${data.domain}`}
	updatedAt={data.asOf}
	overviewHref={`/admin?period=${timeframe}`}
>
	{#snippet context()}{data.domain}{/snippet}
	{#snippet actions()}
		{#if data.available && data.timeframes.length > 0}
			<VisitTimeframes
				timeframes={data.timeframes}
				retentionMonths={data.retentionMonths}
				value={timeframe}
			/>
		{/if}
	{/snippet}
	<ReportNotice collectionEnabled={data.collectionEnabled} available={data.available} />
	<div
		class="admin-cards"
		class:admin-cards-summary={data.collectionEnabled}
		class:admin-cards-inventory={!data.collectionEnabled}
	>
		<StatCard label="Links" value={data.linkCount} />
		{#if data.collectionEnabled}
			<StatCard label="Valid visits" value={validVisits} />
			<StatCard label="Invalid clicks" value={invalidClicks} />
			<StatCard label="Retention" value={formatRetention(data.retentionMonths)} />
		{/if}
	</div>
	{#if data.chart && window}
		<VisitsChart daily={data.chart.daily} {window} {granularity} />
	{/if}
	<section>
		<h2>Base URL</h2>
		<LinkInventory
			label={`Base URL on ${data.domain}`}
			links={baseLinks}
			{timeframe}
			collectionEnabled={data.collectionEnabled}
		/>
	</section>
	<section>
		<h2>Links</h2>
		{#if data.links.length === 0}<p>No links configured.</p>
		{:else}
			<LinkInventory
				label={`Links on ${data.domain}`}
				links={data.links}
				{timeframe}
				collectionEnabled={data.collectionEnabled}
			/>
		{/if}
	</section>
</AdminPage>
