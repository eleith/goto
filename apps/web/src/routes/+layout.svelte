<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import '#lib/styles/reset.css';
	import '#lib/styles/theme.css';
	import '#lib/styles/controls.css';

	let { children }: { children: Snippet } = $props();

	onMount(() => {
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		function followSystem() {
			if (document.documentElement.dataset.themePreference === 'system') {
				document.documentElement.dataset.theme = mediaQuery.matches ? 'dark' : 'light';
			}
		}
		followSystem();
		mediaQuery.addEventListener('change', followSystem);
		return () => mediaQuery.removeEventListener('change', followSystem);
	});
</script>

{@render children()}
