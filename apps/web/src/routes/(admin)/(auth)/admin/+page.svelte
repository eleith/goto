<script lang="ts">
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import { formatCount } from '#lib/components/admin/format.js';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<AdminPage
	title="Overview"
	analyticsEnabled={data.analyticsEnabled}
	lastActivityAt={data.lastActivityAt}
>
	<section aria-labelledby="summary-heading">
		<h2 id="summary-heading">Summary</h2>
		<div class="summary-content">
			{#if data.totalVisits === null}
				<p class="admin-notice" role="status">Visit totals unavailable.</p>
			{/if}
			<div class="admin-cards">
				<StatCard label="Domains" value={data.domainCount} />
				<StatCard label="Links" value={data.linkCount} />
				<StatCard label="Total Visits" value={data.totalVisits} />
			</div>
		</div>
	</section>
	<section>
		<h2>Domains</h2>
		{#if data.domains.length === 0}<p>No domains configured.</p>
		{:else}
			<div
				class="admin-inventory admin-domain-inventory with-visits"
				role="region"
				aria-label="Domain inventory"
			>
				<div class="admin-inventory-heading" aria-hidden="true">
					<span>Host</span><span class="admin-inventory-count">Links</span>
					<span class="admin-inventory-count">Total Visits</span>
				</div>
				<ul class="admin-inventory-list">
					{#each data.domains as row (row.domain)}
						<li>
							<a
								class="admin-inventory-row admin-inventory-link"
								href={row.href}
								aria-label={row.domain}
							>
								<span class="admin-inventory-primary">{row.domain}</span>
								<span class="admin-inventory-secondary">
									<span class="admin-inventory-label">Links</span>
									<span class="admin-inventory-number">{formatCount(row.linkCount)}</span>
								</span>
								<span class="admin-inventory-count">
									<span class="admin-inventory-label">Total Visits</span>
									<span class="admin-inventory-number">{formatCount(row.totalVisits)}</span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</section>
</AdminPage>

<style>
	.summary-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
</style>
