<script lang="ts">
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import { formatCount, formatRetention } from '#lib/components/admin/format.js';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<AdminPage siteTitle={data.title} title="Overview" updatedAt={data.asOf}>
	<ReportNotice collectionEnabled={data.collectionEnabled} available={data.available} />
	<div class="admin-cards admin-cards-summary">
		<StatCard label="Domains" value={data.domainCount} />
		<StatCard label="Links" value={data.linkCount} />
		<StatCard label="Valid visits" value={data.totals?.valid ?? null} />
		<StatCard label="Retention" value={formatRetention(data.retentionMonths)} />
	</div>
	<section>
		<h2>Domains</h2>
		{#if data.domains.length === 0}<p>No domains configured.</p>
		{:else}
			<div class="admin-table-scroll" role="region" aria-label="Domain inventory">
				<table class="admin-table">
					<thead
						><tr
							><th scope="col">Domain</th><th scope="col">Links</th><th scope="col">Visits</th></tr
						></thead
					>
					<tbody>
						{#each data.domains as row (row.domain)}
							<tr>
								<th scope="row"><a class="admin-row-link" href={row.href}>{row.domain}</a></th>
								<td>{formatCount(row.linkCount)}</td>
								<td>{formatCount(row.counts?.valid ?? null)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</AdminPage>
