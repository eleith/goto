<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolveVisitTimeframe, visitGranularity, visitWindow } from '@goto/analytics/daily';
	import AdminPage from '#lib/components/admin/AdminPage.svelte';
	import AdminSelect from '#lib/components/admin/AdminSelect.svelte';
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
	let domainOptions = $derived([
		{ value: '', label: 'All domains' },
		...(data.domainUnavailable && data.domain !== null
			? [{ value: data.domain, label: 'Domain not configured', disabled: true }]
			: []),
		...data.domains.map((domain) => ({ value: domain, label: domain }))
	]);
	let domainIsConfigured = $derived(data.domain !== null && !data.domainUnavailable);
	let redirectOptions = $derived([
		{ value: '', label: 'All redirects' },
		...data.redirectPaths.map((path) => ({ value: path, label: path === '/' ? 'Root (/)' : path })),
		...(data.redirectUnavailable && data.path !== null
			? [{ value: data.path, label: 'Redirect not configured', disabled: true }]
			: [])
	]);
	let selectionNavigationFailed = $state(false);
	let pendingReportNavigations = $state(0);

	async function selectDomain(domain: string): Promise<void> {
		const domainIsSelectable = domain === '' || data.domains.includes(domain);
		if (!domainIsSelectable || domain === (data.domain ?? '')) return;
		const next = new URL(currentUrl.href);
		if (domain) next.searchParams.set('domain', domain);
		else next.searchParams.delete('domain');
		next.searchParams.delete('path');
		await navigateToReport(next);
	}

	async function selectRedirect(path: string): Promise<void> {
		const redirectIsSelectable = path === '' || data.redirectPaths.includes(path);
		if (!domainIsConfigured || !redirectIsSelectable || path === (data.path ?? '')) return;
		const next = new URL(currentUrl.href);
		if (path) next.searchParams.set('path', path);
		else next.searchParams.delete('path');
		await navigateToReport(next);
	}

	async function navigateToReport(next: URL): Promise<void> {
		selectionNavigationFailed = false;
		const committedUrl = currentUrl.href;
		pendingReportNavigations += 1;
		try {
			await goto(next, { reset: false });
		} catch {
			if (currentUrl.href === committedUrl) selectionNavigationFailed = true;
		} finally {
			pendingReportNavigations -= 1;
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
	<div class="analytics-summary">
		<div
			class="report-filters"
			role="group"
			aria-label="Report filters"
			aria-busy={pendingReportNavigations > 0}
		>
			{#key data.domainUnavailable}
				<AdminSelect
					label="Domain"
					committedValue={data.domain ?? ''}
					options={domainOptions}
					onSelectionRequest={selectDomain}
				/>
			{/key}
			{#key data.domain}
				<AdminSelect
					label="Redirect"
					committedValue={domainIsConfigured ? (data.path ?? '') : ''}
					options={redirectOptions}
					onSelectionRequest={selectRedirect}
				/>
			{/key}
		</div>
		{#if counts}
			<div class="admin-cards report-totals">
				<StatCard label="Visits" value={counts.validVisits} />
				<StatCard label="Invalid clicks" value={counts.invalidVisits} />
			</div>
		{/if}
	</div>
	{#if selectionNavigationFailed}
		<p class="admin-notice" role="alert">Could not change the report selection. Try again.</p>
	{/if}
	{#if data.domainUnavailable}
		<p class="admin-notice" role="status">
			This domain is not configured. Choose a domain or select All domains.
		</p>
	{:else if data.redirectUnavailable}
		<p class="admin-notice" role="status">
			This redirect is not configured. Choose a redirect or select All redirects.
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
		--summary-pair-width: calc(2 * var(--summary-card-width) + var(--space-5));
		display: grid;
		grid-template-columns: minmax(0, var(--summary-pair-width));
		gap: var(--space-5);
		align-items: start;
	}

	.report-filters {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
	}

	.report-totals {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	@media (width <= 400px) {
		.analytics-summary {
			grid-template-columns: minmax(0, var(--summary-card-width));
		}

		.report-totals {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (width > 640px) {
		.analytics-summary {
			grid-template-columns: repeat(2, minmax(0, var(--summary-pair-width)));
			justify-content: space-between;
		}

		.report-filters {
			align-self: center;
		}
	}
</style>
