<script lang="ts">
	import { Combobox } from 'bits-ui';
	import { flushSync } from 'svelte';
	import IconCaretDown from 'virtual:icons/ph/caret-down';
	import IconCheck from 'virtual:icons/ph/check';
	import { scopeLabel, scopeValue, type AnalyticsScope, type ScopeGroup } from './report-scopes.js';

	let {
		groups,
		committedScope,
		onSelectionRequest
	}: {
		groups: ScopeGroup[];
		committedScope: AnalyticsScope;
		onSelectionRequest: (scope: AnalyticsScope) => Promise<void>;
	} = $props();

	const id = $props.id();
	const popupId = `${id}-options`;
	const descriptionId = `${id}-committed`;
	let open = $state(false);
	let searchQuery = $state('');
	let viewport = $state<HTMLElement | null>(null);
	let committedValue = $derived(scopeValue(committedScope));
	let committedDescription = $derived.by(() => {
		const label = scopeLabel(committedScope);
		if (committedScope.kind === 'domain') return `Domain: ${label}`;
		if (committedScope.kind === 'tag') return `Tag: ${label}`;
		return label;
	});
	let optionGroups = $derived(
		groups.map(({ label, scopes }) => ({
			label,
			options: scopes.map((scope) => ({
				scope,
				value: scopeValue(scope),
				label: scopeLabel(scope)
			}))
		}))
	);
	let optionsByValue = $derived(
		new Map(
			optionGroups.flatMap(({ options }) =>
				options.map((option) => [option.value, option] as const)
			)
		)
	);
	let matchingGroups = $derived.by(() => {
		const terms = searchQuery.trim().toLowerCase().split(/\s+/);
		return optionGroups
			.map(({ label, options }) => ({
				label,
				options: options.filter((option) => {
					const text = `${label} ${option.label}`.toLowerCase();
					return terms.every((term) => text.includes(term));
				})
			}))
			.filter(({ options }) => options.length > 0);
	});

	function requestSelection(value: string): void {
		if (value === committedValue) return;
		const option = optionsByValue.get(value);
		if (option) void onSelectionRequest(option.scope);
	}

	function updateSearch(text: string): void {
		// Bits UI highlights the first rendered match after this input handler.
		flushSync(() => {
			searchQuery = text;
			open = true;
		});
		if (viewport) viewport.scrollTop = 0;
	}

	function moveFromMissingHighlight(
		event: KeyboardEvent & { currentTarget: HTMLInputElement }
	): void {
		const isArrowDown = event.key === 'ArrowDown';
		const isVerticalArrow = isArrowDown || event.key === 'ArrowUp';
		const hasModifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
		if (!isVerticalArrow || hasModifier || event.isComposing) return;
		if (!open || !viewport || matchingGroups.length === 0) return;

		const input = event.currentTarget;
		const activeId = input.getAttribute('aria-activedescendant');
		const activeOption = activeId ? input.ownerDocument.getElementById(activeId) : null;
		if (viewport.contains(activeOption)) return;

		// Bits UI's Home/End handling can activate a partially visible option.
		event.preventDefault();
		const key = isArrowDown ? 'Home' : 'End';
		input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	}

	function handleOpenChange(isOpen: boolean): void {
		if (!isOpen) searchQuery = '';
	}
</script>

<Combobox.Root
	type="single"
	bind:value={() => committedValue, requestSelection}
	bind:open
	onOpenChange={handleOpenChange}
	allowDeselect={false}
>
	<div class="scope-picker">
		<span id={descriptionId} hidden>Current report: {committedDescription}</span>
		<Combobox.Input
			aria-label="Report scope"
			aria-describedby={descriptionId}
			aria-controls={open ? popupId : undefined}
			autocomplete="off"
			onclick={() => {
				open = true;
			}}
			oninput={(event) => updateSearch(event.currentTarget.value)}
			onkeydown={moveFromMissingHighlight}
		>
			{#snippet child({ props })}
				<!-- Keep the typed draft separate from the label Bits UI writes on selection. -->
				<input
					{...props}
					class="ui-input ui-input--compact scope-input"
					value={searchQuery}
					placeholder={open ? 'Search domains, redirects, or tags…' : committedDescription}
					title={committedDescription}
				/>
			{/snippet}
		</Combobox.Input>
		<Combobox.Trigger aria-label="Show report scopes">
			{#snippet child({ props })}
				<button {...props} type="button" class="scope-trigger">
					<IconCaretDown aria-hidden="true" focusable="false" />
				</button>
			{/snippet}
		</Combobox.Trigger>
	</div>
	<Combobox.Portal>
		<Combobox.Content id={popupId} aria-label="Report scopes" align="start" sideOffset={4}>
			{#snippet child({ props, wrapperProps })}
				<div {...wrapperProps}>
					<div {...props} id={popupId} class="scope-menu">
						<Combobox.Viewport bind:ref={viewport}>
							{#each matchingGroups as group (group.label)}
								<Combobox.Group>
									<Combobox.GroupHeading>
										<span class="scope-group-label">{group.label}</span>
									</Combobox.GroupHeading>
									{#each group.options as option (option.value)}
										<Combobox.Item value={option.value} label={option.label}>
											{#snippet child({ props: optionProps, selected })}
												<div {...optionProps} class="scope-option">
													<span>{option.label}</span>
													{#if selected}<IconCheck aria-hidden="true" focusable="false" />{/if}
												</div>
											{/snippet}
										</Combobox.Item>
									{/each}
								</Combobox.Group>
							{:else}
								<p class="no-scopes" role="status">No matching report scopes.</p>
							{/each}
						</Combobox.Viewport>
					</div>
				</div>
			{/snippet}
		</Combobox.Content>
	</Combobox.Portal>
</Combobox.Root>

<style>
	.scope-picker {
		position: relative;
	}

	.scope-input {
		padding-inline-end: var(--size-icon);
		text-overflow: ellipsis;
	}

	.scope-input::placeholder {
		color: var(--color-text-muted);
		opacity: 1;
	}

	.scope-input[aria-expanded='false']::placeholder {
		color: var(--color-text);
	}

	.scope-trigger {
		position: absolute;
		inset-block: 0;
		inset-inline-end: 0;
		width: var(--size-icon);
		display: grid;
		place-items: center;
		appearance: none;
		padding: 0;
		color: inherit;
		background: transparent;
		border: 0;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.scope-trigger:focus-visible {
		outline: var(--outline-focus);
		outline-offset: calc(-1 * var(--space-1));
	}

	.scope-menu {
		display: flex;
		flex-direction: column;
		z-index: 100;
		width: var(--bits-combobox-anchor-width);
		max-height: min(22rem, var(--bits-combobox-content-available-height));
		padding: var(--space-1);
		font-size: var(--font-size-sm);
		background: var(--color-surface-card);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: var(--radius-control);
		box-shadow: var(--shadow-card);
	}

	.scope-group-label,
	.no-scopes {
		display: block;
		padding: var(--space-1) var(--space-4);
		color: var(--color-text-muted);
	}

	.scope-group-label {
		font-weight: 600;
	}

	.scope-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		min-height: var(--menu-option-min-height);
		padding: var(--space-1) var(--space-4);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.scope-option span {
		min-width: 0;
		overflow-wrap: anywhere;
		white-space: break-spaces;
	}

	.scope-option[data-highlighted]:not([data-selected]) {
		background: var(--color-menu-option-highlight);
	}

	.scope-option[data-selected] {
		color: var(--color-on-primary);
		background: var(--color-primary-fill);
	}
</style>
