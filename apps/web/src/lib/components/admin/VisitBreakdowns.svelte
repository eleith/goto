<script lang="ts">
	import type { VisitCountByName } from '@goto/analytics';
	import VisitBreakdown from './VisitBreakdown.svelte';

	let {
		browserVisits,
		operatingSystemVisits,
		acceptedLanguageVisits,
		totalVisits
	}: {
		browserVisits: VisitCountByName[];
		operatingSystemVisits: VisitCountByName[];
		acceptedLanguageVisits: VisitCountByName[];
		totalVisits: number;
	} = $props();
</script>

<div class="admin-breakdowns">
	<VisitBreakdown
		title="Browsers"
		nameColumnTitle="Browser"
		visitCounts={browserVisits}
		{totalVisits}
	/>
	<VisitBreakdown
		title="Operating systems"
		nameColumnTitle="Operating system"
		visitCounts={operatingSystemVisits}
		{totalVisits}
	/>
	<VisitBreakdown
		title="Accepted languages"
		nameColumnTitle="Language"
		visitCounts={acceptedLanguageVisits}
		{totalVisits}
	/>
</div>
