<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { authClient } from '#lib/auth-client.js';
	import ThemeToggle from '../ThemeToggle.svelte';

	let { title, overviewHref }: { title: string; overviewHref: string } = $props();

	let currentPath = $derived(page.url.pathname + page.url.search);
	let pending = $state(false);
	let signoutError = $state<'rate' | 'network' | 'auth' | null>(null);

	async function signOut(event: SubmitEvent) {
		event.preventDefault();
		if (pending) return;

		const redirectTo = `/signin?callbackUrl=${encodeURIComponent(currentPath)}`;
		pending = true;
		signoutError = null;

		try {
			const { error } = await authClient.signOut();
			if (error) {
				signoutError = error.status === 429 ? 'rate' : 'auth';
				return;
			}
			try {
				await goto(redirectTo, { refreshAll: true });
			} catch {
				const destination = new URL(redirectTo, window.location.origin);
				window.location.assign(
					destination.origin === window.location.origin ? destination.href : '/signin'
				);
			}
		} catch {
			signoutError = 'network';
		} finally {
			pending = false;
		}
	}
</script>

<svelte:window
	onpageshow={(event) => {
		if (event.persisted) pending = false;
	}}
/>

<header class="admin-nav">
	<div class="nav-container">
		<nav aria-label="Administration">
			<a href={overviewHref} aria-current={page.url.pathname === '/admin' ? 'page' : undefined}
				>{title}</a
			>
		</nav>
		<div class="nav-actions">
			<ThemeToggle />
			<form method="POST" aria-label="Sign out" aria-busy={pending} onsubmit={signOut}>
				<button
					type="submit"
					class="ui-button"
					aria-describedby={signoutError ? 'signout-error' : undefined}
					disabled={pending}
				>
					{pending ? 'Signing out…' : 'Sign out'}
				</button>
			</form>
		</div>
	</div>
	{#if signoutError}
		<p id="signout-error" class="signout-error" role="alert">
			{#if signoutError === 'rate'}
				Too many requests. Please wait and try signing out again.
			{:else if signoutError === 'network'}
				Unable to connect. Please try signing out again.
			{:else}
				Unable to sign out. Please try again.
			{/if}
		</p>
	{/if}
</header>

<style>
	.admin-nav {
		padding: var(--space-5);
		border-bottom: var(--border-width) solid var(--color-border-subtle);
	}

	.nav-container {
		max-width: var(--content-admin-width);
		margin-inline: auto;
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-5);
	}

	a {
		color: var(--color-text);
		font-weight: 600;
		text-decoration: none;
	}

	.nav-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
	}

	.signout-error {
		max-width: var(--content-admin-width);
		margin: var(--space-4) auto 0;
		color: var(--color-danger);
		font-size: var(--font-size-sm);
	}
</style>
