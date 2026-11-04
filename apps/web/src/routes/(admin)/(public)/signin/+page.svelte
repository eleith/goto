<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authClient } from '#lib/auth-client.js';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let ready = $state(false);
	let pending = $state(false);
	let submitError = $state<string | null>(null);
	let errorCode = $derived(submitError ?? data.errorCode);

	onMount(() => {
		ready = true;
	});

	async function signIn(event: SubmitEvent) {
		event.preventDefault();
		if (pending) return;

		const formData = new FormData(event.currentTarget as HTMLFormElement);
		pending = true;
		submitError = null;

		try {
			if (data.auth.type === 'oidc') {
				const { error } = await authClient.signIn.social({
					provider: 'oidc',
					callbackURL: data.callbackUrl,
					errorCallbackURL: `/signin?callbackUrl=${encodeURIComponent(data.callbackUrl)}`
				});
				if (error) {
					submitError = error.status === 429 ? 'RateLimited' : 'AuthError';
					pending = false;
				}
				return;
			}

			const { error } = await authClient.$fetch('/sign-in/credentials', {
				method: 'POST',
				body: {
					username: formData.get('username'),
					password: formData.get('password')
				}
			});
			if (error) {
				if (error.status === 401) submitError = 'CredentialsSignin';
				else if (error.status === 429) submitError = 'RateLimited';
				else submitError = 'AuthError';
				pending = false;
				return;
			}
			try {
				await goto(data.callbackUrl, { refreshAll: true });
			} catch {
				const destination = new URL(data.callbackUrl, window.location.origin);
				window.location.assign(
					destination.origin === window.location.origin ? destination.href : '/admin'
				);
			}
		} catch {
			submitError = 'NetworkError';
			pending = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in — {data.title}</title>
</svelte:head>

<svelte:window
	onpageshow={(event) => {
		if (event.persisted) pending = false;
	}}
/>

<div class="signin-container">
	<main class="signin-card">
		<header>
			<h1>Sign in to {data.title}</h1>
		</header>

		{#if errorCode}
			<p class="error-banner" role="alert">
				{#if errorCode === 'CredentialsSignin'}
					Invalid username or password. Please try again.
				{:else if errorCode === 'SessionRequired'}
					Please sign in to access this page.
				{:else if errorCode === 'RateLimited'}
					Too many sign-in attempts. Please wait and try again.
				{:else if errorCode === 'NetworkError'}
					Unable to connect. Please try again.
				{:else}
					An authentication error occurred. Please try again.
				{/if}
			</p>
		{/if}

		<form method="POST" class="signin-form" onsubmit={signIn} aria-busy={pending}>
			{#if data.auth.type === 'credentials'}
				<div class="form-group">
					<label for="username">Username</label>
					<input
						id="username"
						name="username"
						type="text"
						autocomplete="username"
						required
						class="ui-input"
					/>
				</div>
				<div class="form-group">
					<label for="password">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
						required
						class="ui-input"
					/>
				</div>
			{:else if data.auth.type === 'oidc'}
				<p>Single sign-on via {data.auth.name}.</p>
			{/if}
			<button type="submit" class="ui-button ui-button--primary" disabled={!ready || pending}>
				{pending ? 'Signing in…' : 'Sign in'}
			</button>
		</form>
		<ThemeToggle />
	</main>
</div>

<style>
	.signin-container {
		display: flex;
		justify-content: center;
		padding: var(--space-9) var(--space-5);
	}

	.signin-card {
		width: 100%;
		max-width: var(--content-form-width);
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		padding: var(--space-8);
		background: var(--color-surface-card);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
	}

	h1 {
		font-size: var(--font-size-heading);
		line-height: var(--line-height-heading);
	}

	.signin-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	label {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}

	.error-banner {
		padding: var(--space-4) var(--space-5);
		font-size: var(--font-size-sm);
		color: var(--color-danger);
		background: var(--color-danger-bg);
		border: var(--border-width) solid var(--color-danger-border);
		border-radius: var(--radius-control);
	}
</style>
