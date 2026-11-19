<script lang="ts">
	import { page } from '$app/state';
	import ErrorPage from '#lib/components/appearance/ErrorPage.svelte';
</script>

<ErrorPage status={page.status} />
