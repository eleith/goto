<script lang="ts">
	import { page } from '$app/state';
	import { resolveVisitTimeframe, visitGranularity, visitWindow } from '@goto/analytics/daily';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import VisitsChart from '#lib/components/admin/VisitsChart.svelte';
	import VisitTimeframes from '#lib/components/admin/VisitTimeframes.svelte';
	import { formatCount, formatRetention } from '#lib/components/admin/format.js';
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
</script>

<AdminPage siteTitle={data.title} title="Overview" updatedAt={data.asOf}>
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
		<StatCard label="Domains" value={data.domainCount} />
		<StatCard label="Links" value={data.linkCount} />
		{#if data.collectionEnabled}
			<StatCard label="Valid visits" value={validVisits} />
			<StatCard label="Retention" value={formatRetention(data.retentionMonths)} />
		{/if}
	</div>
	{#if data.chart && window}
		<VisitsChart daily={data.chart.daily} {window} {granularity} />
	{/if}
	<section>
		<h2>Domains</h2>
		{#if data.domains.length === 0}<p>No domains configured.</p>
		{:else}
			<div class="admin-table-scroll" role="region" aria-label="Domain inventory">
				<table class="admin-table">
					<thead
						><tr
							><th scope="col">Domain</th><th scope="col">Links</th>{#if data.collectionEnabled}<th
									scope="col">Visits</th
								>{/if}</tr
						></thead
					>
					<tbody>
						{#each data.domains as row (row.domain)}
							<tr>
								<th scope="row"
									><a class="admin-row-link" href={`${row.href}?period=${timeframe}`}
										>{row.domain}</a
									></th
								>
								<td>{formatCount(row.linkCount)}</td>
								{#if data.collectionEnabled}<td
										>{formatCount(row.countsByTimeframe[timeframe]?.validVisits ?? null)}</td
									>{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</AdminPage>
