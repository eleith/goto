<script lang="ts">
	import type { Snippet } from 'svelte';
	import AdminNav from './AdminNav.svelte';
	import { formatUpdated, formatUpdatedCompact } from './format.js';
	import '#lib/styles/admin.css';

	let {
		siteTitle,
		title,
		documentTitle,
		context,
		overviewHref = '/admin',
		updatedAt = null,
		actions,
		children
	}: {
		siteTitle: string;
		title: string;
		documentTitle?: string;
		context?: Snippet;
		overviewHref?: string;
		updatedAt?: number | null;
		actions?: Snippet;
		children: Snippet;
	} = $props();

	let updatedText = $derived(formatUpdated(updatedAt));
	let compactUpdatedText = $derived(formatUpdatedCompact(updatedAt));
</script>

<svelte:head><title>{documentTitle ?? title} — {siteTitle}</title></svelte:head>
<AdminNav title={siteTitle} {overviewHref} />
<main class="admin-page">
	<header class="admin-heading">
		<div class="admin-title-row">
			<div class="admin-title">
				<h1>{title}</h1>
				{#if context}<div class="admin-context">{@render context()}</div>{/if}
				{#if updatedAt !== null}
					<time
						class="admin-updated"
						datetime={new Date(updatedAt).toISOString()}
						title={updatedText}
					>
						<span class="admin-updated-full">{updatedText}</span>
						<span class="admin-updated-compact">{compactUpdatedText}</span>
					</time>
				{/if}
			</div>
			{@render actions?.()}
		</div>
	</header>
	{@render children()}
</main>
