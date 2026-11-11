<script lang="ts">
	import { page } from '$app/state';
	import { resolveVisitTimeframe, visitGranularity, visitWindow } from '@goto/analytics/daily';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import VisitsChart from '#lib/components/admin/VisitsChart.svelte';
	import VisitTimeframes from '#lib/components/admin/VisitTimeframes.svelte';
	import { formatCount } from '#lib/components/admin/format.js';
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
	<div class="admin-cards">
		<StatCard label="Domains" value={data.domainCount} />
		<StatCard label="Links" value={data.linkCount} />
		{#if data.collectionEnabled}
			<StatCard label="Visits" value={visits} />
			<StatCard label="Retention" value={`${data.retentionMonths} months`} />
		{/if}
	</div>
	{#if data.chart && window}
		<VisitsChart daily={data.chart.daily} {window} {granularity} />
	{/if}
	<section>
		<h2>Domains</h2>
		{#if data.domains.length === 0}<p>No domains configured.</p>
		{:else}
			<div
				class="admin-inventory admin-domain-inventory"
				class:with-visits={data.collectionEnabled}
				role="region"
				aria-label="Domain inventory"
			>
				<div class="admin-inventory-heading" aria-hidden="true">
					<span>Domain</span><span class="admin-inventory-count">Links</span
					>{#if data.collectionEnabled}<span class="admin-inventory-count">Visits</span>{/if}
				</div>
				<ul class="admin-inventory-list">
					{#each data.domains as row (row.domain)}
						<li>
							<a
								class="admin-inventory-row admin-inventory-link"
								href={`${row.href}?period=${timeframe}`}
								aria-label={row.domain}
							>
								<span class="admin-inventory-primary">{row.domain}</span>
								<span class="admin-inventory-secondary">
									<span class="admin-inventory-label">Links</span>
									<span class="admin-inventory-number">{formatCount(row.linkCount)}</span>
								</span>
								{#if data.collectionEnabled}
									<span class="admin-inventory-count">
										<span class="admin-inventory-label">Visits</span>
										<span class="admin-inventory-number"
											>{formatCount(row.countsByTimeframe[timeframe]?.validVisits ?? null)}</span
										>
									</span>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</section>
</AdminPage>
