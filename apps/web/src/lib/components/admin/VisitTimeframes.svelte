<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { VisitTimeframe } from '@goto/analytics/daily';

	let {
		timeframes,
		retentionMonths,
		value
	}: {
		timeframes: VisitTimeframe[];
		retentionMonths: number;
		value: VisitTimeframe;
	} = $props();

	async function selectTimeframe(timeframe: VisitTimeframe): Promise<void> {
		if (timeframe === value) return;
		const currentUrl = page.shallow?.url ?? page.url;
		const next = new URL(currentUrl.href);
		if (timeframe === '30d') next.searchParams.delete('period');
		else next.searchParams.set('period', timeframe);
		await goto(next, { state: page.state, shallow: true });
	}
</script>

<div class="timeframes" role="group" aria-label="Timeframe">
	{#each timeframes as timeframe (timeframe)}
		<button
			type="button"
			class="ui-button"
			aria-pressed={value === timeframe}
			onclick={() => selectTimeframe(timeframe)}
		>
			{#if timeframe === '7d'}
				7 days
			{:else if timeframe === '30d'}
				30 days
			{:else if timeframe === '90d'}
				90 days
			{:else}
				{retentionMonths} months
			{/if}
		</button>
	{/each}
</div>

<style>
	.timeframes {
		margin-inline-start: auto;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	button[aria-pressed='true'] {
		font-weight: 600;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 var(--border-width) var(--color-border-strong);
	}
</style>
