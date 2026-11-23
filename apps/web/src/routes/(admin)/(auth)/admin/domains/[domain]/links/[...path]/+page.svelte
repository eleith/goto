<script lang="ts">
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import AnalyticsField from '#lib/components/admin/AnalyticsField.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import { formatUtc } from '#lib/components/admin/format.js';
	import TagPills from '#lib/components/admin/TagPills.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	const statusLabels = {
		active: 'Active',
		disabled: 'Disabled',
		scheduled: 'Scheduled',
		expired: 'Expired',
		exhausted: 'Limit Exceeded'
	};
</script>

<AdminPage
	title="Link"
	analyticsEnabled={data.analyticsEnabled}
	documentTitle={`Link — ${data.domain}${data.path}`}
	lastActivityAt={data.lastActivityAt}
>
	<section aria-labelledby="summary-heading">
		<h2 id="summary-heading">Summary</h2>
		<div class="admin-cards">
			<StatCard label="Total Visits" value={data.lifetimeVisits} />
			<StatCard label="Status" value={statusLabels[data.state]} />
			{#if data.maxVisits !== null}
				<StatCard label="Max visits" value={data.maxVisits} />
			{/if}
		</div>
	</section>
	<section aria-labelledby="redirect-heading">
		<h2 id="redirect-heading">Redirect</h2>
		<div class="admin-info">
			<dl>
				<dt>Domain</dt>
				<dd>
					<a href={`/admin/domains/${encodeURIComponent(data.domain)}`}>
						{data.domain}
					</a>
				</dd>
				<dt>Path</dt>
				<dd>{data.path}</dd>
				{#if data.linkTitle}
					<dt>Title</dt>
					<dd>{data.linkTitle}</dd>
				{/if}
				<dt>Destination</dt>
				<dd class:numbered-setting={data.redirectRules.length > 0}>
					{#if data.redirectRules.length > 0}
						<ol aria-label="Destinations">
							{#each data.redirectRules as rule, index (index)}
								<li>
									<span aria-hidden="true">{index + 1}.</span>
									<a class="admin-destination setting-value" href={rule.to}>{rule.to}</a>
								</li>
							{/each}
							<li>
								<span aria-hidden="true">{data.redirectRules.length + 1}.</span>
								<a class="admin-destination setting-value" href={data.response.url}
									>{data.response.url}</a
								>
							</li>
						</ol>
					{:else}
						<a class="admin-destination" href={data.response.url}>{data.response.url}</a>
					{/if}
				</dd>
				{#if data.redirectRules.length > 0}
					<dt>Rules</dt>
					<dd class="numbered-setting">
						<ol aria-label="Rules">
							{#each data.redirectRules as rule, index (index)}
								<li>
									<span aria-hidden="true">{index + 1}.</span>
									<span class="setting-value">
										{#if rule.language !== null && rule.os !== null}
											language {rule.language} AND OS {rule.os}
										{:else if rule.language !== null}
											language {rule.language}
										{:else}
											OS {rule.os}
										{/if}
									</span>
								</li>
							{/each}
							<li>
								<span aria-hidden="true">{data.redirectRules.length + 1}.</span>
								<span class="setting-value">default</span>
							</li>
						</ol>
					</dd>
				{/if}
				{#if data.analyticsEnabled}
					<AnalyticsField scope={{ kind: 'link', domain: data.domain, path: data.path }} />
				{/if}
			</dl>
		</div>
	</section>
	<section aria-labelledby="settings-heading">
		<h2 id="settings-heading">Settings</h2>
		<div class="admin-info">
			<dl>
				<dt>HTTP status</dt>
				<dd>{data.response.status_code}</dd>
				<dt>Case insensitive</dt>
				<dd>{data.caseInsensitive ? 'Yes' : 'No'}</dd>
				<dt>Trailing slash</dt>
				<dd>{data.ignoreTrailingSlash ? 'Yes' : 'No'}</dd>
				<dt>Path forwarding</dt>
				<dd>{data.forwardPath ? 'Yes' : 'No'}</dd>
				<dt>Query forwarding</dt>
				<dd>{data.response.forward_query ? 'Yes' : 'No'}</dd>
				{#if data.validFrom}
					<dt>Starts</dt>
					<dd>
						<time datetime={data.validFrom}>{formatUtc(data.validFrom)} UTC</time>
					</dd>
				{/if}
				{#if data.validUntil}
					<dt>Expires</dt>
					<dd>
						<time datetime={data.validUntil}>{formatUtc(data.validUntil)} UTC</time>
					</dd>
				{/if}
				{#if data.tags.length > 0}
					<dt>Tags</dt>
					<dd><TagPills tags={data.tags} /></dd>
				{/if}
			</dl>
		</div>
	</section>
</AdminPage>

<style>
	.numbered-setting,
	ol,
	li {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
	}

	ol {
		row-gap: var(--space-1);
		padding: 0;
	}

	.setting-value {
		min-width: 0;
	}

	@media (max-width: 640px) {
		.numbered-setting {
			grid-template-columns: max-content minmax(0, 1fr);
			column-gap: var(--space-4);
		}
	}
</style>
