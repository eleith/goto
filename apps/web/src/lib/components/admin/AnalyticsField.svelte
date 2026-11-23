<script lang="ts">
	import { analyticsHref, type AnalyticsScope } from '#lib/report-scopes.js';

	let { scope }: { scope: AnalyticsScope } = $props();
	let href = $derived(analyticsHref(scope));
</script>

<dt>Analytics</dt>
<dd><a class="analytics-link" {href}>{href}</a></dd>

<style>
	.analytics-link {
		color: var(--color-link);
		text-decoration: underline;
	}

	.analytics-link:hover {
		color: var(--color-link-hover);
	}

	.analytics-link:focus-visible {
		outline-color: currentColor;
	}
</style>
