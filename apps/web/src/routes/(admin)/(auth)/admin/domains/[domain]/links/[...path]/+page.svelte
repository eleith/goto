<script lang="ts">
	import { page } from '$app/state';
	import { resolveVisitTimeframe, visitGranularity, visitWindow } from '@goto/analytics/daily';
	import VisitsChart from '#lib/components/admin/VisitsChart.svelte';
	import BrowserOsBreakdowns from '#lib/components/admin/BrowserOsBreakdowns.svelte';
	import VisitTimeframes from '#lib/components/admin/VisitTimeframes.svelte';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
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
	let browserOsVisits = $derived(data.browserOsVisitsByTimeframe[timeframe] ?? null);
</script>

<AdminPage
	siteTitle={data.title}
	title="Link"
	documentTitle={`Link — ${data.domain}${data.path}`}
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
		{#if data.collectionEnabled}
			<StatCard label="Visits" value={visits} />
		{/if}
		{#if data.state === 'active'}
			<StatCard label="Status" value="Active" />
		{:else if data.state === 'disabled'}
			<StatCard label="Status" value="Disabled" />
		{:else if data.state === 'scheduled'}
			<StatCard label="Status" value="Scheduled" />
		{:else if data.state === 'expired'}
			<StatCard label="Status" value="Expired" />
		{:else}
			<StatCard label="Status" value="Fallback" />
		{/if}
	</div>
	<section class="admin-info" aria-labelledby="link-details-heading">
		<h2 id="link-details-heading">Link details</h2>
		<dl>
			<dt>Domain</dt>
			<dd><a href={`${data.domainHref}?period=${timeframe}`}>{data.domain}</a></dd>
			<dt>Path</dt>
			<dd>{data.path}</dd>
			<dt>Destination</dt>
			<dd>
				{#if data.url}<a class="admin-destination" href={data.url}>{data.url}</a>
				{:else if data.fallback === 404}404 Not found{:else}{data.fallback}{/if}
			</dd>
		</dl>
	</section>
	{#if data.chart && window}
		<VisitsChart daily={data.chart.daily} {window} {granularity} />
	{/if}
	{#if browserOsVisits && visits !== null}
		<BrowserOsBreakdowns {browserOsVisits} totalVisits={visits} />
	{/if}
</AdminPage>
