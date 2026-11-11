<script lang="ts">
	import { formatCount } from './format.js';
	let { label, value }: { label: string; value: number | string | null } = $props();
	let displayValue = $derived(typeof value === 'string' ? value : formatCount(value));
</script>

<section class="admin-stat" aria-label={label}>
	<span class="admin-stat-value" title={displayValue}>{displayValue}</span>
	<span class="admin-stat-label">{label}</span>
</section>
