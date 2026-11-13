<script lang="ts">
	import type { VisitCountsByTimeframe, VisitTimeframe } from '@goto/analytics/daily';
	import type { LinkState } from '#lib/server/link-state.js';
	import { formatCount } from './format.js';

	let {
		label,
		links,
		timeframe,
		collectionEnabled
	}: {
		label: string;
		links: Array<{
			path: string;
			href: string;
			url: string | null;
			state: LinkState;
			countsByTimeframe: VisitCountsByTimeframe;
		}>;
		timeframe: VisitTimeframe;
		collectionEnabled: boolean;
	} = $props();
</script>

<div
	class="admin-inventory admin-link-inventory"
	class:with-visits={collectionEnabled}
	role="region"
	aria-label={label}
>
	<div class="admin-inventory-heading" aria-hidden="true">
		<span>Path</span><span>Destination</span><span>State</span>
		{#if collectionEnabled}<span class="admin-inventory-count">Visits</span>{/if}
	</div>
	<ul class="admin-inventory-list">
		{#each links as link (link.path)}
			<li>
				<a
					class="admin-inventory-row admin-inventory-link"
					href={`${link.href}?period=${timeframe}`}
					aria-label={link.path}
				>
					<span class="admin-inventory-primary"><code>{link.path}</code></span>
					<span class="admin-inventory-secondary">{link.url ?? '404 Not found'}</span>
					<span class="admin-inventory-state">
						{#if link.state === 'active'}Active
						{:else if link.state === 'disabled'}Disabled
						{:else if link.state === 'scheduled'}Scheduled
						{:else if link.state === 'expired'}Expired{/if}
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
