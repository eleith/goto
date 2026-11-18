<script lang="ts">
	import { enhance } from '$app/forms';
	import IconCheckCircle from 'virtual:icons/ph/check-circle';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';
	import IconSpinner from 'virtual:icons/ph/spinner';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import TagPills from '#lib/components/admin/TagPills.svelte';
	import { formatUtc } from '#lib/components/admin/format.js';
	import type { ActionData, PageData, SubmitFunction } from './$types';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();
	let pending = $state(false);
	const checkWorker: SubmitFunction = () => {
		pending = true;
		return async ({ update }) => {
			try {
				await update({ reset: false });
			} finally {
				pending = false;
			}
		};
	};
</script>

<AdminPage siteTitle={data.title} title="Health">
	<section class="admin-info" aria-labelledby="application-heading">
		<h2 id="application-heading">Application</h2>
		<dl>
			<dt>Version</dt>
			<dd>{data.appVersion}</dd>
			<dt>App URL</dt>
			<dd>{data.appUrl}</dd>
			<dt>Authentication</dt>
			<dd>{data.authMode === 'oidc' ? 'OIDC' : 'Shared credentials'}</dd>
		</dl>
	</section>
	<section class="admin-info" aria-labelledby="application-defaults-heading">
		<h2 id="application-defaults-heading">Application defaults</h2>
		<dl>
			<dt>Status code</dt>
			<dd>{data.redirectStatusCode}</dd>
			<dt>Case insensitive</dt>
			<dd>{data.caseInsensitive ? 'Yes' : 'No'}</dd>
			<dt>Trailing slash</dt>
			<dd>{data.ignoreTrailingSlash ? 'Yes' : 'No'}</dd>
			<dt>Path forwarding</dt>
			<dd>{data.forwardPath ? 'Yes' : 'No'}</dd>
			<dt>Query forwarding</dt>
			<dd>{data.forwardQuery ? 'Yes' : 'No'}</dd>
			<dt>Fallback</dt>
			<dd>{data.fallbackDestination === 404 ? '404 Not found' : data.fallbackDestination}</dd>
		</dl>
	</section>
	<section class="admin-info" aria-labelledby="tags-heading">
		<h2 id="tags-heading">Tags</h2>
		{#if data.tags.length > 0}
			<TagPills tags={data.tags} />
		{:else}
			<p>No tags configured.</p>
		{/if}
	</section>
	<section class="admin-info health-card" aria-labelledby="analytics-heading">
		{#if data.retentionMonths !== 0 && !data.activityAvailable}
			<aside class="health-result health-result-error" role="alert">
				<span class="health-result-icon" aria-hidden="true"><IconWarningCircle /></span>
				<div>
					<p class="health-result-title">Analytics activity is unavailable.</p>
				</div>
			</aside>
		{/if}
		<div class="health-card-body">
			<h2 id="analytics-heading">Analytics</h2>
			<dl>
				<dt>Collection</dt>
				<dd>{data.retentionMonths === 0 ? 'Disabled' : 'Enabled'}</dd>
				<dt>Retention</dt>
				<dd>{data.retentionMonths === 0 ? 'Disabled' : `${data.retentionMonths} months`}</dd>
				<dt>Last data activity</dt>
				<dd>
					{#if data.retentionMonths === 0}
						Disabled
					{:else if !data.activityAvailable}
						Unavailable
					{:else if data.lastDataActivity}
						<time datetime={data.lastDataActivity}>{formatUtc(data.lastDataActivity)} UTC</time>
					{:else}
						No recorded activity
					{/if}
				</dd>
			</dl>
		</div>
	</section>
	<section class="admin-info health-card" aria-labelledby="worker-heading">
		{#if !pending && form?.workerCheck}
			<aside
				class="health-result"
				class:health-result-error={!form.workerCheck.reachable}
				role="alert"
			>
				<span class="health-result-icon" aria-hidden="true">
					{#if form.workerCheck.reachable}<IconCheckCircle />{:else}<IconWarningCircle />{/if}
				</span>
				<div>
					<p class="health-result-title">
						{form.workerCheck.reachable ? 'Worker is reachable.' : 'Worker could not be reached.'}
					</p>
					<p class="health-result-time">
						Checked <time datetime={form.workerCheck.checkedAt}
							>{formatUtc(form.workerCheck.checkedAt)} UTC</time
						>
					</p>
				</div>
			</aside>
		{/if}
		<div class="health-card-body">
			<h2 id="worker-heading">Worker</h2>
			<dl>
				<dt>Worker URL</dt>
				<dd>{data.workerUrl}</dd>
			</dl>
			{#if pending || !form?.workerCheck}
				<p class="worker-note" role="status">{pending ? 'Checking worker…' : 'Not checked'}</p>
			{/if}
		</div>
		<div class="worker-actions">
			<form
				class="worker-form"
				method="POST"
				action="?/checkWorker"
				use:enhance={checkWorker}
				aria-busy={pending}
			>
				<button
					type="submit"
					class="ui-button worker-test-button"
					class:busy={pending}
					disabled={pending}
					aria-label={pending ? 'Checking worker' : 'Test worker'}
				>
					<span class="button-label">Test worker</span>
					{#if pending}<span class="worker-spinner" aria-hidden="true"><IconSpinner /></span>{/if}
				</button>
			</form>
		</div>
	</section>
</AdminPage>

<style>
	.health-card {
		padding: 0;
		overflow: hidden;
	}

	.health-card-body {
		padding: var(--space-5);
	}

	.worker-note {
		margin-top: var(--space-5);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.health-result {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-5);
		border-bottom: var(--border-width) solid var(--color-success-border);
		background: var(--color-success-bg);
	}

	.health-result > div {
		min-width: 0;
	}

	.health-result-error {
		border-color: var(--color-danger-border);
		background: var(--color-danger-bg);
	}

	.health-result-icon {
		display: inline-flex;
		flex-shrink: 0;
		font-size: 1.5rem;
		line-height: 1;
		color: var(--color-success);
	}

	.health-result-error .health-result-icon {
		color: var(--color-danger);
	}

	.health-result-title {
		font-weight: 600;
	}

	.health-result-time {
		overflow-wrap: anywhere;
		margin-top: var(--space-1);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.worker-actions {
		padding: var(--space-4) var(--space-5);
		border-top: var(--border-width) solid var(--color-border-subtle);
		background: var(--color-surface-muted);
	}

	.worker-form {
		display: flex;
		justify-content: flex-end;
	}

	.worker-test-button {
		display: inline-grid;
		grid-template-areas: 'content';
		place-items: center;
		border: var(--border-width) solid var(--color-border-strong);
		background: var(--color-surface-card);
	}

	.worker-test-button > * {
		grid-area: content;
	}

	.busy .button-label {
		opacity: 0;
	}

	.worker-spinner {
		display: inline-flex;
		animation: worker-spin 0.9s linear infinite;
	}

	@keyframes worker-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.worker-spinner {
			animation: none;
		}
	}
</style>
