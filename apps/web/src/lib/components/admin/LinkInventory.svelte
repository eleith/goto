<script lang="ts">
	import type { LinkState } from '#lib/server/link-state.js';
	import { formatCount } from './format.js';

	let {
		label,
		links,
		visitLabel,
		showDomain = false
	}: {
		label: string;
		links: Array<{
			domain?: string;
			path: string;
			href: string;
			url?: string | null;
			state: LinkState;
			visits: number | null;
		}>;
		visitLabel: string | null;
		showDomain?: boolean;
	} = $props();
</script>

<div
	class="admin-inventory admin-link-inventory"
	class:with-visits={visitLabel !== null}
	class:with-domains={showDomain}
	role="region"
	aria-label={label}
>
	<div class="admin-inventory-heading" aria-hidden="true">
		{#if showDomain}
			<span>Domain</span><span>Path</span>
		{:else}
			<span>Path</span><span>Destination</span>
		{/if}
		<span>State</span>
		{#if visitLabel}<span class="admin-inventory-count">{visitLabel}</span>{/if}
	</div>
	<ul class="admin-inventory-list">
		{#each links as link (link.href)}
			{@const isRoot = link.path === '/'}
			{@const pathLabel = isRoot ? '(root)' : link.path}
			{@const linkLabel = showDomain ? `${link.domain}${link.path}` : pathLabel}
			<li>
				<a class="admin-inventory-row admin-inventory-link" href={link.href} aria-label={linkLabel}>
					{#if showDomain}
						<span class="admin-inventory-primary">{link.domain}</span>
						<span class="admin-inventory-secondary"><code>{pathLabel}</code></span>
					{:else}
						<span class="admin-inventory-primary"><code>{pathLabel}</code></span>
						<span class="admin-inventory-secondary">{link.url ?? '[not found]'}</span>
					{/if}
					<span class="admin-inventory-state">
						{#if link.state === 'active'}Active
						{:else if link.state === 'disabled'}Disabled
						{:else if link.state === 'scheduled'}Scheduled
						{:else if link.state === 'expired'}Expired
						{:else if link.state === 'exhausted'}Limit Exceeded{/if}
					</span>
					{#if visitLabel}
						<span class="admin-inventory-count">
							{#if isRoot}
								<span class="root-visit-label">Root visits</span>
							{:else}
								<span class="admin-inventory-label">{visitLabel}</span>
							{/if}
							<span class="admin-inventory-number">{formatCount(link.visits)}</span>
						</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
</div>

<style>
	.root-visit-label {
		color: var(--color-text-muted);
	}
</style>
