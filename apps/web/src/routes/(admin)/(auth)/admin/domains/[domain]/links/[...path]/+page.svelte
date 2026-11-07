<script lang="ts">
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import { formatRetention } from '#lib/components/admin/format.js';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<AdminPage
	siteTitle={data.title}
	title={data.path}
	updatedAt={data.asOf}
	backHref={data.domainHref}
	backLabel={data.domain}
>
	<ReportNotice collectionEnabled={data.collectionEnabled} available={data.available} />
	<div class="admin-cards">
		<StatCard label="Valid visits" value={data.totals?.validVisits ?? null} />
		<StatCard label="Retention" value={formatRetention(data.retentionMonths)} />
	</div>
	<section class="admin-info" aria-label="Link details">
		<dl>
			<dt>Destination</dt>
			<dd>
				{#if data.url}<a class="admin-destination" href={data.url}>{data.url}</a>
				{:else if data.fallback === 404}404 Not found{:else}{data.fallback}{/if}
			</dd>
			<dt>State</dt>
			<dd>{data.state}</dd>
		</dl>
	</section>
</AdminPage>
