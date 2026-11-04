<script lang="ts">
	import AdminNav from '#lib/components/AdminNav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Configured links — {data.title}</title>
</svelte:head>

<AdminNav title={data.title} />

<main>
	<header class="page-header">
		<h1>Configured links</h1>
		<p>Read-only. Edit the YAML configuration to change links.</p>
	</header>

	{#if data.domains.length === 0}
		<p>No links configured.</p>
	{:else}
		{#each data.domains as group (group.domain)}
			<section>
				<h2>{group.domain}</h2>
				<div class="table-scroll" role="region" aria-label={`Links on ${group.domain}`}>
					<table>
						<caption>Configured links on {group.domain}</caption>
						<thead>
							<tr>
								<th scope="col">Path</th>
								<th scope="col">Title</th>
								<th scope="col">Destination</th>
								<th scope="col">Enabled</th>
								<th scope="col">HTTP status</th>
							</tr>
						</thead>
						<tbody>
							{#each group.links as link (link.path)}
								<tr>
									<th scope="row"><code>{link.path}</code></th>
									<td>{link.title}</td>
									<td><a href={link.url}>{link.url}</a></td>
									<td>{link.enabled ? 'Yes' : 'No'}</td>
									<td>{link.status_code}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/each}
	{/if}
</main>

<style>
	main {
		max-width: var(--content-admin-width);
		margin-inline: auto;
		padding: var(--space-8) var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	.page-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	h1 {
		font-size: var(--font-size-heading);
		line-height: var(--line-height-heading);
	}

	h2 {
		font-size: var(--font-size-base);
		overflow-wrap: anywhere;
		margin-bottom: var(--space-4);
	}

	.page-header p,
	caption {
		color: var(--color-text-muted);
	}

	.table-scroll {
		overflow-x: auto;
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: var(--radius-card);
		background: var(--color-surface-card);
	}

	.table-scroll:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-sm);
	}

	caption {
		padding: var(--space-4);
		text-align: start;
	}

	th,
	td {
		padding: var(--space-4);
		text-align: start;
		vertical-align: top;
		border-top: var(--border-width) solid var(--color-border-subtle);
		overflow-wrap: anywhere;
	}

	thead {
		background: var(--color-surface-muted);
	}

	a {
		color: var(--color-primary);
	}
</style>
