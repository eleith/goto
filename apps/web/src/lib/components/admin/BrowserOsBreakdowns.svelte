<script lang="ts">
	import type { VisitCountByName, BrowserOsVisits } from '@goto/analytics';
	import { formatCount } from './format.js';

	let { browserOsVisits, totalVisits }: { browserOsVisits: BrowserOsVisits; totalVisits: number } =
		$props();

	const percentFormat = new Intl.NumberFormat('en', {
		style: 'percent',
		maximumFractionDigits: 1
	});
</script>

{#snippet visitCountsCard(title: string, nameColumnTitle: string, visitCounts: VisitCountByName[])}
	<section class="breakdown-card" aria-label={title}>
		<h2>{title}</h2>
		{#if totalVisits === 0}
			<p>No visits in this period.</p>
		{:else}
			<table aria-label={title}>
				<thead>
					<tr>
						<th scope="col">{nameColumnTitle}</th>
						<th scope="col">Visits</th>
						<th scope="col">Share</th>
					</tr>
				</thead>
				<tbody>
					{#each visitCounts as visitCount (visitCount.name)}
						{@const share = visitCount.visits / totalVisits}
						<tr>
							<th scope="row">
								{visitCount.name}
								<span class="bar-track" aria-hidden="true">
									<span class="bar-fill" style:width={`${share * 100}%`}></span>
								</span>
							</th>
							<td>{formatCount(visitCount.visits)}</td>
							<td>{percentFormat.format(share)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
{/snippet}

<div class="browser-os-breakdowns">
	{@render visitCountsCard('Browsers', 'Browser', browserOsVisits.browsers)}
	{@render visitCountsCard(
		'Operating systems',
		'Operating system',
		browserOsVisits.operatingSystems
	)}
</div>

<style>
	.browser-os-breakdowns {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-5);
	}

	.breakdown-card {
		min-width: 0;
		padding: var(--space-5);
		background: var(--color-surface-card);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: var(--radius-card);
	}

	h2 {
		margin: 0 0 var(--space-5);
	}

	table {
		width: 100%;
		table-layout: fixed;
		border-collapse: collapse;
		font-size: var(--font-size-sm);
	}

	th,
	td {
		padding: var(--space-4) var(--space-1);
		text-align: start;
		vertical-align: top;
		overflow-wrap: anywhere;
	}

	thead {
		background: var(--color-surface-muted);
	}

	thead th:not(:first-child) {
		width: 24%;
		text-align: end;
	}

	tbody th,
	tbody td {
		border-top: var(--border-width) solid var(--color-border-subtle);
		font-weight: 400;
	}

	td {
		text-align: end;
		font-variant-numeric: tabular-nums;
	}

	.bar-track {
		display: block;
		height: 0.375rem;
		margin-top: var(--space-1);
		overflow: hidden;
		background: var(--color-surface-muted);
		border-radius: var(--radius-card);
	}

	.bar-fill {
		display: block;
		height: 100%;
		background: var(--color-primary);
	}

	p {
		color: var(--color-text-muted);
	}

	@media (max-width: 640px) {
		.browser-os-breakdowns {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
