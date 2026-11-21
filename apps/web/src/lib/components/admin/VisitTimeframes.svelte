<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Select } from 'bits-ui';
	import IconCaretDown from 'virtual:icons/ph/caret-down';
	import IconCheck from 'virtual:icons/ph/check';
	import { resolveVisitTimeframe, type VisitTimeframe } from '@goto/analytics/daily';

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
		<Select.Root type="single" {value} items={options} onValueChange={changeTimeframe}>
			<Select.Trigger aria-label={`Timeframe: ${labels[value]}`}>
				{#snippet child({ props })}
					<button {...props} type="button" class="ui-input ui-input--compact timeframe-trigger">
						<span>{labels[value]}</span>
						<IconCaretDown aria-hidden="true" focusable="false" />
					</button>
				{/snippet}
			</Select.Trigger>
			<Select.Portal>
				<Select.Content aria-label="Timeframe" align="end" sideOffset={4}>
					{#snippet child({ props, wrapperProps })}
						<div {...wrapperProps}>
							<div {...props} class="timeframe-menu">
								{#each options as option (option.value)}
									<Select.Item value={option.value} label={option.label}>
										{#snippet child({ props: itemProps, selected })}
											<div {...itemProps} class="timeframe-option">
												<span>{option.label}</span>
												{#if selected}<IconCheck aria-hidden="true" focusable="false" />{/if}
											</div>
										{/snippet}
									</Select.Item>
								{/each}
							</div>
						</div>
					{/snippet}
				</Select.Content>
			</Select.Portal>
		</Select.Root>
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
	}

	.timeframe-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		width: 8rem;
		min-width: 8rem;
	}

	.timeframe-menu {
		visibility: hidden;
		z-index: 100;
		width: var(--bits-select-anchor-width);
		max-height: var(--bits-select-content-available-height);
		overflow-y: auto;
		padding: var(--space-1);
		font-size: var(--font-size-sm);
		background: var(--color-surface-card);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: var(--radius-control);
		box-shadow: var(--shadow-card);
	}

	.timeframe-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		min-height: 2.25rem;
		padding: var(--space-1) var(--space-4);
		color: var(--color-text);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.timeframe-option[data-highlighted]:not([data-selected]) {
		background: var(--color-surface-muted);
	}

	.timeframe-option[data-selected],
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

		.timeframe-menu {
			visibility: visible;
		}
	}
</style>
