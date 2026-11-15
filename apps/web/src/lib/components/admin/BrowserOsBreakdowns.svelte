<script lang="ts">
	import type { BrowserOsVisits } from '@goto/analytics';
	import VisitBreakdown from './VisitBreakdown.svelte';

	let { browserOsVisits, totalVisits }: { browserOsVisits: BrowserOsVisits; totalVisits: number } =
		$props();
</script>

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
