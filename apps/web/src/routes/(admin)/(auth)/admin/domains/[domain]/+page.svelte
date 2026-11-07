<script lang="ts">
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import { formatCount, formatRetention } from '#lib/components/admin/format.js';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<AdminPage siteTitle={data.title} title={data.domain} updatedAt={data.asOf} backHref="/admin">
	<ReportNotice collectionEnabled={data.collectionEnabled} available={data.available} />
	<div class="admin-cards admin-cards-summary">
		<StatCard label="Links" value={data.linkCount} />
		<StatCard label="Valid visits" value={data.totals?.valid ?? null} />
		<StatCard label="Invalid clicks" value={data.invalidClicks} />
		<StatCard label="Retention" value={formatRetention(data.retentionMonths)} />
	</div>
	<section>
		<h2>Base URL</h2>
		<div class="admin-table-scroll" role="region" aria-label={`Base URL on ${data.domain}`}>
			<table class="admin-table admin-link-table">
				<thead
					><tr
						><th scope="col">Path</th><th scope="col">Destination</th><th scope="col">State</th><th
							scope="col">Visits</th
						></tr
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
						<td>{formatCount(data.base.counts?.valid ?? null)}</td>
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
							><th scope="col">Visits</th></tr
						></thead
					>
					<tbody>
						{#each data.links as link (link.path)}
							<tr>
								<th scope="row"
									><a class="admin-row-link" href={link.href}><code>{link.path}</code></a></th
								>
								<td><a class="admin-destination" href={link.url}>{link.url}</a></td>
								<td>{link.state}</td><td>{formatCount(link.counts?.valid ?? null)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</AdminPage>
