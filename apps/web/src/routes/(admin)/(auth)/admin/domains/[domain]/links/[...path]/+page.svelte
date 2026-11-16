<script lang="ts">
	import { page } from '$app/state';
	import { resolveVisitTimeframe, visitGranularity, visitWindow } from '@goto/analytics/daily';
	import VisitBreakdowns from '#lib/components/admin/VisitBreakdowns.svelte';
	import VisitsChart from '#lib/components/admin/VisitsChart.svelte';
	import VisitTimeframes from '#lib/components/admin/VisitTimeframes.svelte';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import AnalyticsSection from '#lib/components/admin/AnalyticsSection.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import { formatUtc } from '#lib/components/admin/format.js';
	import TagPills from '#lib/components/admin/TagPills.svelte';
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
	let browserVisits = $derived(data.browserVisitsByTimeframe[timeframe] ?? null);
	let operatingSystemVisits = $derived(data.operatingSystemVisitsByTimeframe[timeframe] ?? null);
	let acceptedLanguageVisits = $derived(data.acceptedLanguageVisitsByTimeframe[timeframe] ?? null);
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
	<section class="admin-info" aria-labelledby="redirect-heading">
		<h2 id="redirect-heading">Redirect</h2>
		<dl>
			<dt>Domain</dt>
			<dd>
				<a href={`/admin/domains/${encodeURIComponent(data.domain)}?period=${timeframe}`}>
					{data.domain}
				</a>
			</dd>
			<dt>Path</dt>
			<dd>{data.path}</dd>
			<dt>Destination</dt>
			<dd class:numbered-setting={data.redirectRules.length > 0}>
				{#if data.redirectRules.length > 0}
					<ol aria-label="Destinations">
						{#each data.redirectRules as rule, index (index)}
							<li>
								<span aria-hidden="true">{index + 1}.</span>
								<a class="admin-destination setting-value" href={rule.to}>{rule.to}</a>
							</li>
						{/each}
						<li>
							<span aria-hidden="true">{data.redirectRules.length + 1}.</span>
							<a class="admin-destination setting-value" href={data.response.url}
								>{data.response.url}</a
							>
						</li>
					</ol>
				{:else}
					<a class="admin-destination" href={data.response.url}>{data.response.url}</a>
				{/if}
			</dd>
			{#if data.redirectRules.length > 0}
				<dt>Rules</dt>
				<dd class="numbered-setting">
					<ol aria-label="Rules">
						{#each data.redirectRules as rule, index (index)}
							<li>
								<span aria-hidden="true">{index + 1}.</span>
								<span class="setting-value">
									{#if rule.language !== null && rule.os !== null}
										language {rule.language} AND OS {rule.os}
									{:else if rule.language !== null}
										language {rule.language}
									{:else}
										OS {rule.os}
									{/if}
								</span>
							</li>
						{/each}
						<li>
							<span aria-hidden="true">{data.redirectRules.length + 1}.</span>
							<span class="setting-value">default</span>
						</li>
					</ol>
				</dd>
			{/if}
		</dl>
	</section>
	<section class="admin-info" aria-labelledby="settings-heading">
		<h2 id="settings-heading">Settings</h2>
		<dl>
			<dt>HTTP status</dt>
			<dd>{data.response.status_code}</dd>
			<dt>Case insensitive</dt>
			<dd>{data.caseInsensitive ? 'Yes' : 'No'}</dd>
			<dt>Trailing slash</dt>
			<dd>{data.ignoreTrailingSlash ? 'Yes' : 'No'}</dd>
			<dt>Path forwarding</dt>
			<dd>{data.forwardPath ? 'Yes' : 'No'}</dd>
			<dt>Query forwarding</dt>
			<dd>{data.response.forward_query ? 'Yes' : 'No'}</dd>
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
				<dd><TagPills tags={data.tags} {timeframe} /></dd>
			{/if}
		</dl>
	</section>
	<AnalyticsSection>
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

<style>
	.numbered-setting,
	ol,
	li {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
	}

	ol {
		row-gap: var(--space-1);
		padding: 0;
	}

	.setting-value {
		min-width: 0;
	}

	@media (max-width: 640px) {
		.numbered-setting {
			grid-template-columns: max-content minmax(0, 1fr);
			column-gap: var(--space-4);
		}
	}
</style>
