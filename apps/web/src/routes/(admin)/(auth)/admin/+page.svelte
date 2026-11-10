<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { visitGranularity, visitWindow, type VisitTimeframe } from '@goto/analytics/daily';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import VisitsChart from '#lib/components/admin/VisitsChart.svelte';
	import { formatCount, formatRetention } from '#lib/components/admin/format.js';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	let currentUrl = $derived(page.shallow?.url ?? page.url);
	let timeframe = $derived(
		selectedTimeframe(data.timeframes, currentUrl.searchParams.get('period'))
	);
	let window = $derived(data.chart ? visitWindow(data.chart.period, timeframe) : null);
	let granularity = $derived(
		data.chart ? visitGranularity(timeframe, data.chart.period.retentionMonths) : 'day'
	);
	let validVisits = $derived(data.visitsByTimeframe[timeframe] ?? null);

	function selectedTimeframe(
		available: VisitTimeframe[],
		requested: string | null
	): VisitTimeframe {
		return available.find((value) => value === requested) ?? '30d';
	}

	function timeframeLabel(value: VisitTimeframe): string {
		if (value === '7d') return '7 days';
		if (value === '30d') return '30 days';
		if (value === '90d') return '90 days';
		return `${data.retentionMonths} months`;
	}

	async function selectTimeframe(value: VisitTimeframe): Promise<void> {
		if (value === timeframe) return;
		const next = new URL(currentUrl.href);
		if (value === '30d') next.searchParams.delete('period');
		else next.searchParams.set('period', value);
		await goto(next, { state: page.state, shallow: true });
	}
</script>

<AdminPage siteTitle={data.title} title="Overview" updatedAt={data.asOf}>
	{#snippet actions()}
		{#if data.available && data.timeframes.length > 0}
			<div class="overview-timeframes" role="group" aria-label="Timeframe">
				{#each data.timeframes as option (option)}
					<button
						type="button"
						class="ui-button"
						aria-pressed={timeframe === option}
						onclick={() => selectTimeframe(option)}>{timeframeLabel(option)}</button
					>
				{/each}
			</div>
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
								<th scope="row"><a class="admin-row-link" href={row.href}>{row.domain}</a></th>
								<td>{formatCount(row.linkCount)}</td>
								{#if data.collectionEnabled}<td
										>{formatCount(row.visitsByTimeframe[timeframe] ?? null)}</td
									>{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</AdminPage>
