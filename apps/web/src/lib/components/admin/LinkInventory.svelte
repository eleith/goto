<script lang="ts">
	import type { VisitCountsByTimeframe, VisitTimeframe } from '@goto/analytics/daily';
	import type { LinkState } from '#lib/server/link-state.js';
	import { formatCount } from './format.js';

	let {
		label,
		links,
		timeframe,
		collectionEnabled,
		showDomain = false
	}: {
		label: string;
		links: Array<{
			domain?: string;
			path: string;
			href: string;
			url?: string | null;
			state: LinkState;
			countsByTimeframe: VisitCountsByTimeframe;
		}>;
		timeframe: VisitTimeframe;
		collectionEnabled: boolean;
		showDomain?: boolean;
	} = $props();
</script>

<div
	class="admin-inventory admin-link-inventory"
	class:with-visits={collectionEnabled}
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
		{#if collectionEnabled}<span class="admin-inventory-count">Visits</span>{/if}
	</div>
	<ul class="admin-inventory-list">
		{#each links as link (link.href)}
			{@const pathLabel = link.path === '/' ? '(root)' : link.path}
			{@const linkLabel = showDomain ? `${link.domain}${link.path}` : pathLabel}
			<li>
				<a
					class="admin-inventory-row admin-inventory-link"
					href={`${link.href}?period=${timeframe}`}
					aria-label={linkLabel}
				>
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
					{#if collectionEnabled}
						<span class="admin-inventory-count">
							<span class="admin-inventory-label">Visits</span>
							<span class="admin-inventory-number"
								>{formatCount(link.countsByTimeframe[timeframe]?.validVisits ?? null)}</span
							>
						</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
</div>
