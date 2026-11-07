<script lang="ts">
	let { collectionEnabled, available }: { collectionEnabled: boolean; available: boolean } =
		$props();
</script>

{#if !collectionEnabled}
	<p class="admin-notice" role="status">Analytics disabled.</p>
{:else if !available}
	<p class="admin-notice" role="status">Statistics unavailable.</p>
{/if}
