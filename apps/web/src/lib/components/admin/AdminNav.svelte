<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import IconChartLineUp from 'virtual:icons/ph/chart-line-up';
	import IconHeartbeat from 'virtual:icons/ph/heartbeat';
	import IconSignOut from 'virtual:icons/ph/sign-out';
	import { authClient } from '#lib/auth-client.js';
	import ThemeToggle from '../ThemeToggle.svelte';

	let { overviewHref, analyticsEnabled }: { overviewHref: string; analyticsEnabled: boolean } =
		$props();

	let currentPath = $derived(page.url.pathname + page.url.search);
	let onOverview = $derived(page.url.pathname === '/admin');
	let pending = $state(false);
	let signoutLabel = $derived(pending ? 'Signing out…' : 'Sign out');
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

{#snippet titleWithIcon()}
	<img src="/@static/favicon.svg" alt="" width="24" height="24" />
	GoTo
{/snippet}

<header class="admin-nav">
	<nav class="nav-container" aria-label="Administration">
		{#if onOverview}
			<span class="nav-title" aria-current="page">{@render titleWithIcon()}</span>
		{:else}
			<a class="nav-title" href={overviewHref}>{@render titleWithIcon()}</a>
		{/if}
		<div class="nav-actions">
			{#if analyticsEnabled}
				<a
					class="ui-button nav-icon"
					href="/admin/analytics"
					aria-label="Analytics"
					title="Analytics"
					aria-current={page.url.pathname === '/admin/analytics' ? 'page' : undefined}
				>
					<IconChartLineUp aria-hidden="true" focusable="false" />
				</a>
			{/if}
			<a
				class="ui-button nav-icon"
				href="/admin/health"
				aria-label="Health"
				title="Health"
				aria-current={page.url.pathname === '/admin/health' ? 'page' : undefined}
			>
				<IconHeartbeat aria-hidden="true" focusable="false" />
			</a>
			<ThemeToggle />
			<form method="POST" aria-label="Sign out" aria-busy={pending} onsubmit={signOut}>
				<button
					type="submit"
					class="ui-button signout-button"
					aria-label={signoutLabel}
					title={signoutLabel}
					aria-describedby={signoutError ? 'signout-error' : undefined}
					disabled={pending}
				>
					<span class="signout-text">{signoutLabel}</span>
					<span class="signout-icon"><IconSignOut aria-hidden="true" focusable="false" /></span>
				</button>
			</form>
		</div>
	</nav>
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

	.nav-title {
		display: inline-flex;
		align-items: center;
		gap: var(--space-4);
		color: var(--color-text);
		font-weight: 600;
		text-decoration: none;
	}

	.nav-icon {
		width: var(--control-min-height);
		padding: 0;
		font-size: 1.25rem;
	}

	.nav-actions {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	.signout-icon {
		display: none;
	}

	@media (max-width: 640px) {
		.admin-nav {
			padding-inline: var(--space-4);
		}

		.nav-container,
		.nav-actions {
			gap: var(--space-1);
		}

		.signout-button {
			width: var(--control-min-height);
			padding: 0;
			font-size: 1.25rem;
		}

		.signout-text {
			display: none;
		}

		.signout-icon {
			display: flex;
		}
	}

	.signout-error {
		max-width: var(--content-admin-width);
		margin: var(--space-4) auto 0;
		color: var(--color-danger);
		font-size: var(--font-size-sm);
	}
</style>
