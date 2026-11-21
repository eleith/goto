<script lang="ts">
	import type { Snippet } from 'svelte';
	import AdminNav from './AdminNav.svelte';
	import { formatLastVisit, formatLastVisitCompact } from './format.js';
	import '#lib/styles/admin.css';

	let {
		title: heading,
		documentTitle,
		context,
		overviewHref = '/admin',
		lastActivityAt = null,
		actions,
		children
	}: {
		title: string;
		documentTitle?: string;
		context?: Snippet;
		overviewHref?: string;
		lastActivityAt?: number | null;
		actions?: Snippet;
		children: Snippet;
	} = $props();

	let activityText = $derived(formatLastVisit(lastActivityAt));
	let compactActivityText = $derived(formatLastVisitCompact(lastActivityAt));
</script>

<svelte:head><title>{documentTitle ?? heading} — GoTo</title></svelte:head>
<AdminNav {overviewHref} />
<main class="admin-page">
	<header class="admin-heading">
		<div class="admin-title-row">
			<div class="admin-title">
				<h1 title={heading}>{heading}</h1>
				{#if context}<div class="admin-context">{@render context()}</div>{/if}
				{#if lastActivityAt !== null}
					<time
						class="admin-updated"
						datetime={new Date(lastActivityAt).toISOString()}
						title="Last visit {activityText} UTC"
					>
						<span class="admin-updated-full">Last visit {activityText} UTC</span>
						<span class="admin-updated-compact">Last visit {compactActivityText} UTC</span>
					</time>
				{/if}
			</div>
			{@render actions?.()}
		</div>
	</header>
	{@render children()}
</main>
