<script lang="ts">
	import { page } from '$app/state';
	import { resolveVisitTimeframe, visitGranularity, visitWindow } from '@goto/analytics/daily';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import VisitsChart from '#lib/components/admin/VisitsChart.svelte';
	import BrowserOsBreakdowns from '#lib/components/admin/BrowserOsBreakdowns.svelte';
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
	let baseVisits = $derived(data.base.countsByTimeframe[timeframe]?.validVisits ?? null);
	let invalidClicks = $derived(data.invalidClicksByTimeframe[timeframe] ?? null);
	let browserOsVisits = $derived(data.browserOsVisitsByTimeframe[timeframe] ?? null);
</script>

<AdminPage
	siteTitle={data.title}
	title="Domain"
	documentTitle={`Domain — ${data.domain}`}
	updatedAt={data.asOf}
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
	<ReportNotice collectionEnabled={data.collectionEnabled} available={data.available} />
	<div class="admin-cards">
		<StatCard label="Links" value={data.linkCount} />
		{#if data.collectionEnabled}
			<StatCard label="Visits" value={visits} />
			<StatCard label="Invalid clicks" value={invalidClicks} />
			<a
				class="base-visits-link"
				href={`${data.base.href}?period=${timeframe}`}
				aria-label="Base visits"
			>
				<StatCard label="Base visits" value={baseVisits} />
			</a>
		{/if}
	</div>
	<section class="admin-info" aria-labelledby="domain-details-heading">
		<h2 id="domain-details-heading">Domain details</h2>
		<dl>
			<dt>Domain</dt>
			<dd>{data.domain}</dd>
			<dt>Base destination</dt>
			<dd>
				{#if data.base.url}<a class="admin-destination" href={data.base.url}>{data.base.url}</a>
				{:else}404 Not found{/if}
			</dd>
			<dt>Base status</dt>
			<dd>
				{#if data.base.hasRoot}Active{:else}Fallback{/if}
			</dd>
		</dl>
	</section>
	{#if data.chart && window}
		<VisitsChart daily={data.chart.daily} {window} {granularity} />
	{/if}
	{#if browserOsVisits && visits !== null}
		<BrowserOsBreakdowns {browserOsVisits} totalVisits={visits} />
	{/if}
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

<style>
	.base-visits-link {
		color: inherit;
		text-decoration: none;
		border-radius: var(--radius-card);
	}
</style>
