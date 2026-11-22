<script lang="ts">
	import { Select } from 'bits-ui';
	import IconCaretDown from 'virtual:icons/ph/caret-down';
	import IconCheck from 'virtual:icons/ph/check';

	let {
		label,
		committedValue,
		options,
		onSelectionRequest,
		mobileOnly = false
	}: {
		label: string;
		committedValue: string;
		options: { value: string; label: string; disabled?: boolean }[];
		onSelectionRequest: (value: string) => void | Promise<void>;
		mobileOnly?: boolean;
	} = $props();

	let selectedLabel = $derived(
		options.find((option) => option.value === committedValue)?.label ?? committedValue
	);
</script>

<Select.Root type="single" bind:value={() => committedValue, onSelectionRequest} items={options}>
	<Select.Trigger aria-label={`${label}: ${selectedLabel}`} title={selectedLabel}>
		{#snippet child({ props })}
			<button {...props} type="button" class="ui-input ui-input--compact select-trigger">
				<span class="trigger-label">{selectedLabel}</span>
				<IconCaretDown class="select-icon" aria-hidden="true" focusable="false" />
			</button>
		{/snippet}
	</Select.Trigger>
	<Select.Portal>
		<Select.Content aria-label={label} align="end" sideOffset={4}>
			{#snippet child({ props, wrapperProps })}
				<div {...wrapperProps}>
					<div {...props} class="select-menu" class:mobile-only={mobileOnly}>
						<Select.Viewport>
							{#each options as option (option.value)}
								<Select.Item
									value={option.value}
									label={option.label}
									disabled={option.disabled ?? false}
								>
									{#snippet child({ props: itemProps, selected })}
										<div {...itemProps} class="select-option">
											<span class="option-label">{option.label}</span>
											{#if selected}<IconCheck
													class="select-icon"
													aria-hidden="true"
													focusable="false"
												/>{/if}
										</div>
									{/snippet}
								</Select.Item>
							{/each}
						</Select.Viewport>
					</div>
				</div>
			{/snippet}
		</Select.Content>
	</Select.Portal>
</Select.Root>

<style>
	.select-trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		text-align: start;
	}

	.trigger-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.select-trigger :global(.select-icon),
	.select-option :global(.select-icon) {
		flex: none;
	}

	.select-menu {
		display: flex;
		flex-direction: column;
		z-index: 100;
		width: var(--bits-select-anchor-width);
		max-height: var(--bits-select-content-available-height);
		padding: var(--space-1);
		font-size: var(--font-size-sm);
		background: var(--color-surface-card);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: var(--radius-control);
		box-shadow: var(--shadow-card);
	}

	.select-option {
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

	.option-label {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.select-option[data-highlighted]:not([data-selected]) {
		background: light-dark(
			var(--color-surface-muted),
			color-mix(in srgb, var(--color-text) 30%, var(--color-surface-card))
		);
	}

	.select-option[data-selected] {
		color: var(--color-on-primary);
		background: var(--color-primary-fill);
	}

	.select-option[data-disabled] {
		opacity: 0.5;
		cursor: default;
	}

	@media (width > 640px) {
		.select-menu.mobile-only {
			visibility: hidden;
		}
	}
</style>
