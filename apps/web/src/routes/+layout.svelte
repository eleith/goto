<script lang="ts">
	import { onMount } from 'svelte';
	import type { LayoutProps } from './$types';
	import DocumentHead from '#lib/components/appearance/DocumentHead.svelte';
	import '#lib/styles/reset.css';
	import '#lib/styles/theme.css';
	import '#lib/styles/controls.css';

	let { children, data }: LayoutProps = $props();

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

<DocumentHead origin={data.origin ?? null} />
{@render children()}
