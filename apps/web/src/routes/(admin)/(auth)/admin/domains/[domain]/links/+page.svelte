<script lang="ts">
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import AnalyticsField from '#lib/components/admin/AnalyticsField.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<AdminPage
	title="Root"
	analyticsEnabled={data.analyticsEnabled}
	documentTitle={`Root — ${data.domain}`}
	lastActivityAt={data.lastActivityAt}
>
	<section aria-labelledby="summary-heading">
		<h2 id="summary-heading">Summary</h2>
		<div class="summary-content">
			{#if data.totalVisits === null}
				<p class="admin-notice" role="status">Visit totals unavailable.</p>
			{/if}
			<div class="admin-cards">
				<StatCard label="Total Visits" value={data.totalVisits} />
			</div>
		</div>
	</section>
	<section aria-labelledby="root-details-heading">
		<h2 id="root-details-heading">Root details</h2>
		<div class="admin-info">
			<dl>
				<dt>Domain</dt>
				<dd><a href={data.domainHref}>{data.domain}</a></dd>
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
				{#if data.analyticsEnabled}
					<AnalyticsField scope={{ kind: 'domain', domain: data.domain }} />
				{/if}
			</dl>
		</div>
	</section>
	<section id="fallback" aria-labelledby="fallback-heading">
		<h2 id="fallback-heading">Fallback</h2>
		<div class="admin-info">
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
		</div>
	</section>
</AdminPage>

<style>
	.summary-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
</style>
