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
	let invalidClicks = $derived(data.invalidClicksByTimeframe[timeframe] ?? null);
</script>

<AdminPage
	siteTitle={data.title}
	title={data.domain}
	updatedAt={data.asOf}
	backHref={`/admin?period=${timeframe}`}
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
		<div class="admin-table-scroll" role="region" aria-label={`Base URL on ${data.domain}`}>
			<table class="admin-table admin-link-table">
				<thead
					><tr
						><th scope="col">Path</th><th scope="col">Destination</th><th scope="col">State</th
						>{#if data.collectionEnabled}<th scope="col">Visits</th>{/if}</tr
					></thead
				>
				<tbody>
					<tr>
						<th scope="row"><a class="admin-row-link" href={data.base.href}><code>/</code></a></th>
						<td
							>{#if data.base.url}<a class="admin-destination" href={data.base.url}
									>{data.base.url}</a
								>{:else}404 Not found{/if}</td
						>
						<td>{data.base.state}</td>
						{#if data.collectionEnabled}<td
								>{formatCount(data.base.countsByTimeframe[timeframe]?.validVisits ?? null)}</td
							>{/if}
					</tr>
				</tbody>
			</table>
		</div>
	</section>
	<section>
		<h2>Links</h2>
		{#if data.links.length === 0}<p>No links configured.</p>
		{:else}
			<div class="admin-table-scroll" role="region" aria-label={`Links on ${data.domain}`}>
				<table class="admin-table admin-link-table">
					<thead
						><tr
							><th scope="col">Path</th><th scope="col">Destination</th><th scope="col">State</th
							>{#if data.collectionEnabled}<th scope="col">Visits</th>{/if}</tr
						></thead
					>
					<tbody>
						{#each data.links as link (link.path)}
							<tr>
								<th scope="row"
									><a class="admin-row-link" href={link.href}><code>{link.path}</code></a></th
								>
								<td><a class="admin-destination" href={link.url}>{link.url}</a></td>
								<td>{link.state}</td>
								{#if data.collectionEnabled}<td
										>{formatCount(link.countsByTimeframe[timeframe]?.validVisits ?? null)}</td
									>{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</AdminPage>
