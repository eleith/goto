<script lang="ts">
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import LinkInventory from '#lib/components/admin/LinkInventory.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<AdminPage
	title="Domain"
	analyticsEnabled={data.analyticsEnabled}
	documentTitle={`Domain — ${data.domain}`}
	lastActivityAt={data.lastActivityAt}
>
	<section aria-labelledby="summary-heading">
		<h2 id="summary-heading">Summary</h2>
		<div class="summary-content">
			{#if data.totalVisits === null}
				<p class="admin-notice" role="status">Visit totals unavailable.</p>
			{/if}
			<div class="admin-cards">
				<StatCard label="Links" value={data.linkCount} />
				<StatCard label="Total Visits" value={data.totalVisits} />
				<StatCard label="Invalid clicks" value={data.invalidClicks} />
			</div>
		</div>
	</section>
	<section aria-labelledby="domain-details-heading">
		<h2 id="domain-details-heading">Details</h2>
		<div class="admin-info">
			<dl>
				<dt>Domain</dt>
				<dd>{data.domain}</dd>
				<dt>Root</dt>
				<dd>
					{#if data.root}
						<a class="admin-destination" href={data.root.url}>{data.root.url}</a>
					{:else}Uses fallback{/if}
				</dd>
				<dt>Fallback</dt>
				<dd>
					{#if data.fallback}
						<a class="admin-destination" href={data.fallback.url}>{data.fallback.url}</a>
					{:else}404 Not found{/if}
				</dd>
			</dl>
		</div>
	</section>
	<section>
		<h2>Links</h2>
		<LinkInventory label={`Links on ${data.domain}`} links={data.links} visitLabel="Total Visits" />
	</section>
</AdminPage>

<style>
	.summary-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
</style>
