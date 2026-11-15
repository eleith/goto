<script lang="ts">
	import type { BrowserOsVisits } from '@goto/analytics';
	import VisitBreakdown from './VisitBreakdown.svelte';

	let { browserOsVisits, totalVisits }: { browserOsVisits: BrowserOsVisits; totalVisits: number } =
		$props();
</script>

<div class="browser-os-breakdowns">
	<VisitBreakdown
		title="Browsers"
		nameColumnTitle="Browser"
		visitCounts={browserOsVisits.browsers}
		{totalVisits}
	/>
	<VisitBreakdown
		title="Operating systems"
		nameColumnTitle="Operating system"
		visitCounts={browserOsVisits.operatingSystems}
		{totalVisits}
	/>
</div>

<style>
	.browser-os-breakdowns {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-5);
	}

	@media (max-width: 640px) {
		.browser-os-breakdowns {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
