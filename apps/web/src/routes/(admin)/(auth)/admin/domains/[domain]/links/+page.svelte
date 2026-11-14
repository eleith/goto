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
	title="Root"
	documentTitle={`Root — ${data.domain}`}
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
	</div>
	<section class="admin-info" aria-labelledby="root-details-heading">
		<h2 id="root-details-heading">Root details</h2>
		<dl>
			<dt>Domain</dt>
			<dd><a href={`${data.domainHref}?period=${timeframe}`}>{data.domain}</a></dd>
			<dt>Address</dt>
			<dd>{data.domain}/</dd>
			<dt>Destination</dt>
			<dd>
				{#if data.response}
					<a class="admin-destination" href={data.response.url}>
						{data.response.url}
					</a>
				{:else}
					<a href="#fallback">Uses fallback</a>
				{/if}
			</dd>
			{#if data.response}
				<dt>HTTP status</dt>
				<dd>{data.response.status_code}</dd>
				<dt>Forward query</dt>
				<dd>{data.response.forward_query ? 'Yes' : 'No'}</dd>
			{/if}
		</dl>
	</section>
	<section id="fallback" class="admin-info" aria-labelledby="fallback-heading">
		<h2 id="fallback-heading">Fallback</h2>
		<dl>
			<dt>Source</dt>
			<dd>
				{#if data.fallbackSource === 'domain'}Domain
				{:else if data.fallbackSource === 'global'}Global
				{:else}Default{/if}
			</dd>
			<dt>Destination</dt>
			<dd>
				{#if data.fallback}
					<a class="admin-destination" href={data.fallback.url}>
						{data.fallback.url}
					</a>
				{:else}404 Not found{/if}
			</dd>
			{#if data.fallback}
				<dt>HTTP status</dt>
				<dd>{data.fallback.status_code}</dd>
				<dt>Forward query</dt>
				<dd>{data.fallback.forward_query ? 'Yes' : 'No'}</dd>
			{/if}
		</dl>
	</section>
	{#if data.chart && window}
		<VisitsChart daily={data.chart.daily} {window} {granularity} />
	{/if}
	{#if browserOsVisits && visits !== null}
		<BrowserOsBreakdowns {browserOsVisits} totalVisits={visits} />
	{/if}
</AdminPage>
