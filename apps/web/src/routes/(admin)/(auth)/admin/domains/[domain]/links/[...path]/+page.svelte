<script lang="ts">
	import { page } from '$app/state';
	import { resolveVisitTimeframe, visitGranularity, visitWindow } from '@goto/analytics/daily';
	import type { SettingSource } from '@goto/config';
	import VisitsChart from '#lib/components/admin/VisitsChart.svelte';
	import BrowserOsBreakdowns from '#lib/components/admin/BrowserOsBreakdowns.svelte';
	import VisitTimeframes from '#lib/components/admin/VisitTimeframes.svelte';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import { formatUtc } from '#lib/components/admin/format.js';
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

{#snippet sourceHint(source: SettingSource)}
	<span class="source-hint">
		{#if source === 'builtin'}Built-in
		{:else if source === 'global'}Global defaults
		{:else if source === 'domain'}Domain defaults
		{:else}Link override{/if}
	</span>
{/snippet}

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
				<a class="admin-destination" href={data.response.url}>
					{data.response.url}
				</a>
			</dd>
			<dt>HTTP status</dt>
			<dd>
				{data.response.status_code}
				{@render sourceHint(data.sources.status_code)}
			</dd>
			<dt>Forward query</dt>
			<dd>
				{data.response.forward_query ? 'Yes' : 'No'}
				{@render sourceHint(data.sources.forward_query)}
			</dd>
			{#if data.validFrom}
				<dt>Starts</dt>
				<dd>
					<time datetime={data.validFrom}>{formatUtc(data.validFrom)}</time>
				</dd>
			{/if}
			{#if data.validUntil}
				<dt>Expires</dt>
				<dd>
					<time datetime={data.validUntil}>{formatUtc(data.validUntil)}</time>
				</dd>
			{/if}
			{#if data.tags.length > 0}
				<dt>Tags</dt>
				<dd>{data.tags.join(', ')}</dd>
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

<style>
	.source-hint {
		margin-inline-start: calc(var(--space-1) * 2);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}
</style>
