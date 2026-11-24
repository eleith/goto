<script lang="ts">
	import { onMount } from 'svelte';
	import type { Chart, ChartOptions } from 'chart.js';
	import type { VisitDetails } from '@goto/analytics';
	import { groupVisitDays, type VisitGranularity, type VisitWindow } from '@goto/analytics/daily';
	import { formatCount } from './format.js';

	let {
		daily,
		window: viewWindow,
		granularity,
		visitLabel = 'Visits'
	}: {
		daily: VisitDetails['daily'];
		window: VisitWindow;
		granularity: VisitGranularity;
		visitLabel?: string;
	} = $props();
	let ready = $state(false);
	let unavailable = $state(false);
	let canvas = $state<HTMLCanvasElement>();
	let palette: HTMLSpanElement;
	let chart: Chart<'line', number[], string> | undefined;

	const groupingLabels: Record<VisitGranularity, string> = {
		day: 'Daily',
		week: 'Weekly',
		month: 'Monthly'
	};
	const dateFormat = new Intl.DateTimeFormat('en', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	});
	const monthFormat = new Intl.DateTimeFormat('en', {
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
	let buckets = $derived(groupVisitDays(daily, viewWindow, granularity));
	let total = $derived(buckets.reduce((sum, bucket) => sum + bucket.validVisits, 0));
	let summary = $derived(
		`${visitLabel} by ${granularity}. Total: ${formatCount(total)}. ${windowLabel(viewWindow)}.`
	);

	function windowLabel(window: VisitWindow): string {
		const from = new Date(window.from);
		const end = new Date(Date.parse(window.asOf) - 1);
		return `${dateFormat.formatRange(from, end)} UTC`;
	}

	function bucketLabel(start: string, grouping: VisitGranularity): string {
		return (grouping === 'month' ? monthFormat : dateFormat).format(new Date(start));
	}

	function bucketPeriod(bucket: VisitDetails['daily'][number]): string {
		const startTime = Math.max(Date.parse(bucket.start), Date.parse(viewWindow.from));
		const endTime = Math.min(Date.parse(bucket.end), Date.parse(viewWindow.asOf)) - 1;
		const from = new Date(startTime);
		const end = new Date(endTime);
		return dateFormat.formatRange(from, end);
	}

	function chartOptions(points: VisitDetails['daily']): ChartOptions<'line'> {
		const colors = getComputedStyle(palette);
		return {
			responsive: true,
			maintainAspectRatio: false,
			animation: false,
			interaction: { mode: 'index', intersect: false },
			scales: {
				x: {
					type: 'category',
					ticks: { color: colors.outlineColor, maxTicksLimit: 8, maxRotation: 0 },
					grid: { display: false },
					border: { color: colors.borderTopColor }
				},
				y: {
					type: 'linear',
					beginAtZero: true,
					ticks: {
						color: colors.outlineColor,
						precision: 0,
						callback: (value) => formatCount(Number(value))
					},
					grid: { color: colors.borderTopColor },
					border: { display: false }
				}
			},
			plugins: {
				tooltip: {
					displayColors: false,
					backgroundColor: colors.backgroundColor,
					titleColor: colors.outlineColor,
					bodyColor: colors.color,
					footerColor: colors.outlineColor,
					borderColor: colors.borderTopColor,
					borderWidth: 1,
					callbacks: {
						title: (items) => {
							const bucket = points[items[0]?.dataIndex ?? -1];
							return bucket ? `${bucketPeriod(bucket)} UTC` : '';
						},
						label: (item) => `${visitLabel}: ${formatCount(item.parsed.y)}`,
						footer: (items) => (points[items[0]?.dataIndex ?? -1]?.partial ? 'Partial period' : '')
					}
				}
			}
		};
	}

	function updateChart(points: VisitDetails['daily'], grouping: VisitGranularity) {
		if (!chart) return;
		const color = getComputedStyle(palette).color;
		chart.data.labels = points.map((point) => bucketLabel(point.start, grouping));
		chart.data.datasets = [
			{
				label: visitLabel,
				data: points.map((point) => point.validVisits),
				borderColor: color,
				borderWidth: 2,
				pointRadius: points.length === 1 ? 3 : 0,
				pointHoverRadius: 4,
				pointBackgroundColor: color,
				fill: false,
				tension: 0
			}
		];
		chart.options = chartOptions(points);
		chart.update('none');
	}

	$effect(() => {
		const points = buckets;
		const grouping = granularity;
		if (ready) updateChart(points, grouping);
	});

	onMount(() => {
		let disposed = false;
		const themeObserver = new MutationObserver(() => updateChart(buckets, granularity));
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme']
		});

		async function mountChart() {
			const element = canvas;
			if (!element) {
				unavailable = true;
				return;
			}
			let chartClass: typeof Chart | undefined;
			try {
				const runtime = await import('chart.js');
				if (disposed) return;
				chartClass = runtime.Chart;
				const context = element.getContext('2d');
				if (!context) {
					unavailable = true;
					return;
				}
				runtime.Chart.register(
					runtime.LineController,
					runtime.LineElement,
					runtime.PointElement,
					runtime.CategoryScale,
					runtime.LinearScale,
					runtime.Tooltip
				);
				chart = new runtime.Chart<'line', number[], string>(context, {
					type: 'line',
					data: { labels: [], datasets: [] },
					options: chartOptions(buckets)
				});
				updateChart(buckets, granularity);
				ready = true;
			} catch {
				if (disposed) return;
				chartClass?.getChart(element)?.destroy();
				chart = undefined;
				unavailable = true;
			}
		}

		void mountChart();
		return () => {
			disposed = true;
			themeObserver.disconnect();
			chart?.destroy();
			chart = undefined;
		};
	});
</script>

<section class="visits-chart" aria-label={`${visitLabel} over time`}>
	<header>
		<h2>{visitLabel}</h2>
		<span class="grouping">{groupingLabels[granularity]}</span>
	</header>
	<span class="chart-palette" bind:this={palette} hidden aria-hidden="true"></span>
	{#if unavailable}
		<p role="status">Chart unavailable.</p>
	{:else}
		<div class="plot" role="img" aria-label={summary} aria-busy={!ready}>
			<canvas bind:this={canvas} aria-hidden="true">{summary}</canvas>
		</div>
	{/if}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard scrolling needs a focusable region.) -->
	<div class="table-scroll" role="region" aria-label="Visit data" tabindex="0">
		<table aria-label={visitLabel}>
			<thead>
				<tr><th scope="col">Period (UTC)</th><th scope="col">{visitLabel}</th></tr>
			</thead>
			<tbody>
				{#each buckets as bucket (bucket.start)}
					<tr>
						<th scope="row">{bucketPeriod(bucket)}</th>
						<td>{formatCount(bucket.validVisits)}</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr><th scope="row">Total</th><td>{formatCount(total)}</td></tr>
			</tfoot>
		</table>
	</div>
</section>

<style>
	.visits-chart {
		min-width: 0;
		padding: var(--space-5);
		background: var(--color-surface-card);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: var(--radius-card);
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-5);
	}

	header h2 {
		margin: 0;
	}

	.grouping {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.plot {
		position: relative;
		height: clamp(15rem, 32vw, 22rem);
		min-width: 0;
	}

	.table-scroll {
		max-block-size: 18rem;
		overflow: auto;
		margin-top: var(--space-5);
		margin-inline: calc(-1 * var(--space-5));
		margin-bottom: calc(-1 * var(--space-5));
		border-radius: 0 0 var(--radius-card) var(--radius-card);
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
		padding: var(--space-4) var(--space-5);
		border-top: var(--border-width) solid var(--color-border-subtle);
		text-align: start;
		vertical-align: top;
		overflow-wrap: anywhere;
	}

	thead th {
		position: sticky;
		top: 0;
		z-index: 1;
		border-top: 0;
		background: var(--color-surface-muted);
	}

	tbody tr:nth-child(even) {
		background: var(--color-surface-muted);
	}

	tbody th,
	tfoot th {
		font-weight: 400;
	}

	thead th:last-child {
		width: 7rem;
		text-align: end;
	}

	td {
		text-align: end;
		font-variant-numeric: tabular-nums;
	}

	.chart-palette {
		color: var(--color-primary);
		background-color: var(--color-surface-card);
		border-color: var(--color-border-subtle);
		outline-color: var(--color-text-muted);
	}

	p {
		color: var(--color-text-muted);
	}
</style>
