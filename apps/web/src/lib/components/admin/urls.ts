import type { VisitTimeframe } from '@goto/analytics/daily';

export function linkHref(domain: string, path: string): string {
	const base = `/admin/domains/${encodeURIComponent(domain)}/links`;
	if (path === '/') return base;
	const segments = path.slice(1).split('/').map(encodeURIComponent);
	return `${base}/${segments.join('/')}`;
}

export function tagHref(tag: string, timeframe?: VisitTimeframe): string {
	const href = `/admin/tags/${encodeURIComponent(tag)}`;
	if (timeframe === undefined) return href;
	return `${href}?period=${timeframe}`;
}
