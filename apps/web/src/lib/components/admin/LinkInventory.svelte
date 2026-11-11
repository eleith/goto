<script lang="ts">
	import type { VisitCountsByTimeframe, VisitTimeframe } from '@goto/analytics/daily';
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
			state: string;
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
		{#if collectionEnabled}<span>Visits</span>{/if}
	</div>
	<ul class="admin-inventory-list">
		{#each links as link (link.path)}
			<li>
				<a class="admin-inventory-row admin-inventory-link" href={link.href} aria-label={link.path}>
					<span class="admin-inventory-primary"><code>{link.path}</code></span>
					<span class="admin-inventory-secondary">{link.url ?? '404 Not found'}</span>
					<span class="admin-inventory-state">{link.state}</span>
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
