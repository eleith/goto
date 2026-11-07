<script lang="ts">
	import type { Snippet } from 'svelte';
	import AdminNav from './AdminNav.svelte';
	import { formatUpdated } from './format.js';
	import '#lib/styles/admin.css';

	let {
		siteTitle,
		title,
		updatedAt = null,
		backHref = '',
		backLabel = 'Overview',
		children
	}: {
		siteTitle: string;
		title: string;
		updatedAt?: number | null;
		backHref?: string;
		backLabel?: string;
		children: Snippet;
	} = $props();
</script>

<svelte:head><title>{title} — {siteTitle}</title></svelte:head>
<AdminNav title={siteTitle} />
<main class="admin-page">
	<header class="admin-heading">
		{#if backHref}<nav aria-label="Breadcrumb"><a href={backHref}>{backLabel}</a></nav>{/if}
		<div class="admin-title-row">
			<h1>{title}</h1>
			{#if updatedAt !== null}
				<time class="admin-updated" datetime={new Date(updatedAt).toISOString()}
					>{formatUpdated(updatedAt)}</time
				>
			{/if}
		</div>
	</header>
	{@render children()}
</main>
