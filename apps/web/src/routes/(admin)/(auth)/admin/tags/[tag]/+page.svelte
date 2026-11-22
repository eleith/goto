<script lang="ts">
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import LinkInventory from '#lib/components/admin/LinkInventory.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<AdminPage
	analyticsEnabled={data.analyticsEnabled}
	title={`Tag: ${data.tag}`}
	lastActivityAt={data.lastActivityAt}
>
	<section aria-labelledby="summary-heading">
		<h2 id="summary-heading">Summary</h2>
		<div class="admin-cards">
			<StatCard label="Domains" value={data.domainCount} />
			<StatCard label="Links" value={data.links.length} />
			<StatCard label="Total Visits" value={data.totalVisits} />
		</div>
	</section>
	<section>
		<h2>Links</h2>
		<LinkInventory
			label={`Links tagged ${data.tag}`}
			links={data.links}
			visitLabel="Total Visits"
			showDomain
		/>
	</section>
</AdminPage>
