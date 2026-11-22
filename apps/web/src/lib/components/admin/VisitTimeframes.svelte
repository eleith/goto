<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolveVisitTimeframe, type VisitTimeframe } from '@goto/analytics/daily';
	import AdminSelect from './AdminSelect.svelte';

	let {
		timeframes,
		retentionMonths,
		value
	}: {
		timeframes: VisitTimeframe[];
		retentionMonths: number;
		value: VisitTimeframe;
	} = $props();

	let labels = $derived({
		'7d': '7 days',
		'30d': '30 days',
		'90d': '90 days',
		all: retentionMonths === 3 ? '90 days' : 'Full retention'
	});
	let options = $derived(
		timeframes.map((timeframe) => ({ value: timeframe, label: labels[timeframe] }))
	);

	async function selectTimeframe(timeframe: VisitTimeframe): Promise<void> {
		if (timeframe === value) return;
		const currentUrl = page.shallow?.url ?? page.url;
		const next = new URL(currentUrl.href);
		if (timeframe === '30d') next.searchParams.delete('period');
		else next.searchParams.set('period', timeframe);
		await goto(next, { state: page.state, shallow: true });
	}

	async function changeTimeframe(selected: string): Promise<void> {
		const timeframe = resolveVisitTimeframe(timeframes, selected);
		await selectTimeframe(timeframe);
	}
</script>

<div class="timeframes">
	<div class="buttons" role="group" aria-label="Timeframe">
		{#each options as option (option.value)}
			<button
				type="button"
				class="ui-button"
				aria-pressed={value === option.value}
				onclick={() => selectTimeframe(option.value)}>{option.label}</button
			>
		{/each}
	</div>
	<div class="mobile-select">
		<AdminSelect
			label="Timeframe"
			committedValue={value}
			{options}
			onSelectionRequest={changeTimeframe}
			mobileOnly
		/>
	</div>
</div>

<style>
	.timeframes {
		margin-inline-start: auto;
		display: flex;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.mobile-select {
		display: none;
		width: 8rem;
	}

	button[aria-pressed='true'],
	button[aria-pressed='true']:hover {
		color: var(--color-on-primary);
		background: var(--color-primary-fill);
		box-shadow: none;
	}

	@media (max-width: 640px) {
		.buttons {
			display: none;
		}

		.mobile-select {
			display: block;
		}
	}
</style>
