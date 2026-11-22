<script lang="ts">
	import { tagHref } from './urls.js';

	let { tags }: { tags: readonly string[] } = $props();
	let uniqueTags = $derived([...new Set(tags)]);
</script>

<ul class="tags" aria-label="Tags">
	{#each uniqueTags as tag (tag)}
		<li><a href={tagHref(tag)}>{tag}</a></li>
	{/each}
</ul>

<style>
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		min-width: 0;
		max-width: 100%;
	}

	a {
		box-sizing: border-box;
		display: block;
		min-height: 24px;
		max-width: 100%;
		padding: var(--space-1) var(--space-4);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		text-decoration: none;
		white-space: break-spaces;
		overflow-wrap: anywhere;
		background: color-mix(in srgb, var(--color-text) 15%, var(--color-surface-card));
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-control);
	}

	a:hover {
		background: color-mix(in srgb, var(--color-text) 22%, var(--color-surface-card));
	}

	a:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}
</style>
