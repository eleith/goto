<script lang="ts">
	import { onMount } from 'svelte';
	import type { Chart, ChartOptions } from 'chart.js';
	import type { VisitDetails } from '@goto/analytics';
	import { groupVisitDays, type VisitGranularity, type VisitWindow } from '@goto/analytics/daily';
	import { formatCount } from './format.js';

	let {
		daily,
		window: viewWindow,
		granularity
	}: {
		daily: VisitDetails['daily'];
		window: VisitWindow;
		granularity: VisitGranularity;
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
		`Valid visits by ${granularity}. Total: ${formatCount(total)}. ${windowLabel(viewWindow)}.`
	);

	function windowLabel(window: VisitWindow): string {
		const from = new Date(window.from);
		const end = new Date(Date.parse(window.asOf) - 1);
		return `${dateFormat.formatRange(from, end)} UTC`;
	}

	function bucketLabel(start: string, grouping: VisitGranularity): string {
		return (grouping === 'month' ? monthFormat : dateFormat).format(new Date(start));
	}

	function bucketTitle(bucket: VisitDetails['daily'][number]): string {
		const startTime = Math.max(Date.parse(bucket.start), Date.parse(viewWindow.from));
		const endTime = Math.min(Date.parse(bucket.end), Date.parse(viewWindow.asOf)) - 1;
		const from = new Date(startTime);
		const end = new Date(endTime);
		return `${dateFormat.formatRange(from, end)} UTC`;
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
							return bucket ? bucketTitle(bucket) : '';
						},
						label: (item) => `Valid visits: ${formatCount(item.parsed.y)}`,
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
				label: 'Valid visits',
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

<section class="visits-chart" aria-label="Visits over time" aria-busy={!ready && !unavailable}>
	<header>
		<h2>Visits</h2>
		<span class="grouping">{groupingLabels[granularity]}</span>
	</header>
	<span class="chart-palette" bind:this={palette} hidden aria-hidden="true"></span>
	{#if unavailable}
		<p role="status">Chart unavailable.</p>
	{:else}
		<div class="plot" role="img" aria-label={summary}>
			<canvas bind:this={canvas} aria-hidden="true">{summary}</canvas>
		</div>
	{/if}
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
