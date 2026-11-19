<svelte:options css="injected" />

<script lang="ts">
	let { status }: { status: number } = $props();
</script>

<svelte:head>
	<title>{status === 404 ? 'Not found' : `Error ${status}`} — Goto</title>
</svelte:head>

<main class="error-page">
	<img class="app-icon" src="/@static/favicon.svg" alt="Goto" />
	<h1>
		{#if status === 404}
			Not found
		{:else if status < 500}
			Unable to open this page
		{:else}
			Something went wrong
		{/if}
	</h1>
</main>

<style>
	.error-page {
		display: grid;
		place-content: center;
		justify-items: center;
		gap: var(--space-5);
		min-height: 100svh;
		padding: var(--space-8) var(--space-5);
		background: light-dark(#d9e3e7, #13232b);
		color: light-dark(#1c3039, #e0eaee);
		text-align: center;
	}

	.app-icon {
		display: block;
		width: clamp(5rem, 15vw, 7rem);
		height: auto;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.75rem, 5vw, 2.5rem);
		line-height: var(--line-height-heading);
		overflow-wrap: anywhere;
	}
</style>
