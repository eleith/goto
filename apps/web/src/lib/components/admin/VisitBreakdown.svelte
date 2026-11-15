<script lang="ts">
	import type { VisitCountByName } from '@goto/analytics';
	import { formatCount } from './format.js';

	let {
		title: heading,
		nameColumnTitle,
		visitCounts,
		totalVisits
	}: {
		title: string;
		nameColumnTitle: string;
		visitCounts: VisitCountByName[];
		totalVisits: number;
	} = $props();

	const percentFormat = new Intl.NumberFormat('en', {
		style: 'percent',
		maximumFractionDigits: 1
	});
</script>

<section class="breakdown-card" aria-label={heading}>
	<h2 title={heading}>{heading}</h2>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard scrolling needs a focusable region.) -->
	<div class="table-scroll" role="region" aria-label={`${heading} data`} tabindex="0">
		{#if totalVisits === 0}
			<p>No visits in this period.</p>
		{:else}
			<table aria-label={heading}>
				<thead>
					<tr>
						<th scope="col" title={nameColumnTitle}>{nameColumnTitle}</th>
						<th scope="col">Visits</th>
						<th scope="col">Share</th>
					</tr>
				</thead>
				<tbody>
					{#each visitCounts as visitCount (visitCount.name)}
						{@const share = visitCount.visits / totalVisits}
						<tr>
							<th scope="row">
								<span class="breakdown-name" title={visitCount.name}>{visitCount.name}</span>
								<span class="bar-track" aria-hidden="true">
									<span class="bar-fill" style:width={`${share * 100}%`}></span>
								</span>
							</th>
							<td title={formatCount(visitCount.visits)}>{formatCount(visitCount.visits)}</td>
							<td title={percentFormat.format(share)}>{percentFormat.format(share)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</section>

<style>
	.breakdown-card {
		--breakdown-header-height: 3rem;
		--breakdown-row-height: 3.5rem;
		min-width: 0;
		padding: var(--space-5);
		background: var(--color-surface-card);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: var(--radius-card);
	}

	h2 {
		margin: 0 0 var(--space-5);
		line-height: var(--line-height-heading);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.table-scroll {
		block-size: calc(var(--breakdown-header-height) + 5 * var(--breakdown-row-height));
		overflow: auto;
	}

	.table-scroll:focus-visible {
		outline: var(--outline-focus);
		outline-offset: calc(-1 * var(--space-1));
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	thead tr {
		height: var(--breakdown-header-height);
	}

	thead th {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--color-surface-muted);
	}

	tbody tr {
		height: var(--breakdown-row-height);
	}

	tbody tr:nth-child(even) {
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

	.breakdown-name {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
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
</style>
