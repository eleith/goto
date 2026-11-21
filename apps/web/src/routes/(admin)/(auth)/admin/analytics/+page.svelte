<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolveVisitTimeframe, visitGranularity, visitWindow } from '@goto/analytics/daily';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import ReportNotice from '#lib/components/admin/ReportNotice.svelte';
	import StatCard from '#lib/components/admin/StatCard.svelte';
	import VisitBreakdowns from '#lib/components/admin/VisitBreakdowns.svelte';
	import VisitsChart from '#lib/components/admin/VisitsChart.svelte';
	import VisitTimeframes from '#lib/components/admin/VisitTimeframes.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let report = $derived(data.report);
	let currentUrl = $derived(page.shallow?.url ?? page.url);
	let timeframe = $derived(
		resolveVisitTimeframe(data.timeframes, currentUrl.searchParams.get('period'))
	);
	let counts = $derived(report?.countsByTimeframe[timeframe]);
	let domainNavigationFailed = $state(false);

	async function selectDomain(select: HTMLSelectElement): Promise<void> {
		const domain = select.value;
		select.value = data.domain ?? '';
		domainNavigationFailed = false;

		const committedUrl = currentUrl.href;
		const next = new URL(committedUrl);
		if (domain) next.searchParams.set('domain', domain);
		else next.searchParams.delete('domain');

		try {
			await goto(next, { reset: false });
		} catch {
			if (currentUrl.href === committedUrl) domainNavigationFailed = true;
		}
	}
</script>

<AdminPage title="Analytics" analyticsEnabled lastActivityAt={report?.lastActivityAt ?? null}>
	{#snippet actions()}
		{#if report}
			<VisitTimeframes
				timeframes={data.timeframes}
				retentionMonths={data.retentionMonths}
				value={timeframe}
			/>
		{/if}
	{/snippet}
	<div class="admin-cards analytics-summary">
		<select
			class="ui-input ui-input--compact domain-filter"
			aria-label="Domain"
			title={data.domain ?? undefined}
			value={data.domain ?? ''}
			onchange={(event) => selectDomain(event.currentTarget)}
		>
			<option value="">All domains</option>
			{#if data.domainUnavailable}
				<option value={data.domain} disabled>Domain not configured</option>
			{/if}
			{#each data.domains as domain (domain)}
				<option value={domain}>{domain}</option>
			{/each}
		</select>
		{#if counts}
			<StatCard label="Visits" value={counts.validVisits} />
			<StatCard label="Invalid clicks" value={counts.invalidVisits} />
		{/if}
	</div>
	{#if domainNavigationFailed}
		<p class="admin-notice" role="alert">Could not change the domain. Try again.</p>
	{/if}
	{#if data.domainUnavailable}
		<p class="admin-notice" role="status">
			This domain is not configured. Choose a domain or select All domains.
		</p>
	{:else}
		<ReportNotice collectionEnabled available={report !== null} />
	{/if}
	{#if report && counts}
		<VisitsChart
			daily={report.daily}
			window={visitWindow(report.period, timeframe)}
			granularity={visitGranularity(timeframe, report.period.retentionMonths)}
		/>
		<VisitBreakdowns
			browserVisits={report.browserVisitsByTimeframe[timeframe] ?? []}
			operatingSystemVisits={report.operatingSystemVisitsByTimeframe[timeframe] ?? []}
			acceptedLanguageVisits={report.acceptedLanguageVisitsByTimeframe[timeframe] ?? []}
			totalVisits={counts.validVisits}
		/>
	{/if}
</AdminPage>

<style>
	.analytics-summary {
		--summary-card-width: 12rem;
		--domain-filter-width: 14rem;
		grid-template-columns: repeat(2, minmax(0, var(--summary-card-width)));
		align-items: start;
	}

	.domain-filter {
		grid-column: 1 / -1;
		justify-self: start;
		width: auto;
		max-width: min(var(--domain-filter-width), 100%);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (width <= 400px) {
		.analytics-summary {
			grid-template-columns: minmax(0, var(--summary-card-width));
		}
	}

	@media (width > 640px) {
		.analytics-summary {
			grid-template-columns: fit-content(var(--domain-filter-width)) repeat(
					2,
					minmax(0, var(--summary-card-width))
				);
		}

		.domain-filter {
			grid-column: auto;
		}
	}
</style>
