<script lang="ts">
	import { onMount } from 'svelte';

	type Preference = 'system' | 'dark' | 'light';
	let preference = $state<Preference>('system');
	let ready = $state(false);

	function applyTheme() {
		let appliedTheme = preference;
		if (preference === 'system') {
			appliedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		document.documentElement.dataset.themePreference = preference;
		document.documentElement.dataset.theme = appliedTheme;
	}

	function cycleTheme() {
		if (preference === 'system') {
			preference = 'dark';
		} else if (preference === 'dark') {
			preference = 'light';
		} else {
			preference = 'system';
		}
		applyTheme();
		try {
			window.localStorage.setItem('goto.theme', preference);
		} catch {
			// Keep the in-memory preference when storage is blocked.
		}
	}

	onMount(() => {
		const restored = document.documentElement.dataset.themePreference;
		if (restored === 'dark' || restored === 'light' || restored === 'system') {
			preference = restored;
		}
		applyTheme();
		ready = true;
	});
</script>

<button type="button" class="ui-button" disabled={!ready} onclick={cycleTheme}>
	{#if preference === 'system'}
		Switch to dark theme
	{:else if preference === 'dark'}
		Switch to light theme
	{:else}
		Use system theme
	{/if}
</button>
