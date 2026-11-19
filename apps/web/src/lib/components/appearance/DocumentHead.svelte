<script lang="ts">
	let { origin }: { origin: string | null } = $props();
</script>

<svelte:head>
	<link rel="icon" href={`${origin ?? ''}/@static/favicon.svg`} type="image/svg+xml" sizes="any" />
	<meta name="description" content="Quick links. To get there. Quickly." />
	<meta property="og:type" content="website" />
	<meta property="og:title" content="Goto" />
	<meta property="og:site_name" content="Goto" />
	<meta property="og:description" content="Quick links. To get there. Quickly." />
	{#if origin}
		<meta property="og:url" content={`${origin}/`} />
		<meta property="og:image" content={`${origin}/@static/og.png`} />
		<meta property="og:image:type" content="image/png" />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="630" />
		<meta property="og:image:alt" content="Goto — Quick links. To get there. Quickly." />
	{/if}
</svelte:head>
