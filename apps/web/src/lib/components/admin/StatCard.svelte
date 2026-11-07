<script lang="ts">
	import { formatCount } from './format.js';
	let { label, value }: { label: string; value: number | string | null } = $props();
</script>

<section class="admin-stat" aria-label={label}>
	<span class="admin-stat-value">{typeof value === 'string' ? value : formatCount(value)}</span>
	<span class="admin-stat-label">{label}</span>
</section>
