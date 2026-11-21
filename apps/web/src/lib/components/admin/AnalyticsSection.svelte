<script lang="ts">
	import type { Snippet } from 'svelte';

	let { heading = 'Analytics', children }: { heading?: string; children: Snippet } = $props();
</script>

<section aria-labelledby="analytics-heading">
	<h2 id="analytics-heading">{heading}</h2>
	<div class="analytics-content">
		{@render children()}
	</div>
</section>

<style>
	.analytics-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}
</style>
