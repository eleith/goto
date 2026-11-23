import type { ReportScope } from '@goto/analytics';

export type AnalyticsScope = ReportScope | { kind: 'tag'; tag: string };

export type ScopeGroup = {
	label: string;
	scopes: AnalyticsScope[];
};

export function scopeLabel(scope: AnalyticsScope): string {
	switch (scope.kind) {
		case 'overview':
			return 'All traffic';
		case 'domain':
			return scope.domain;
		case 'link':
			return `${scope.domain}${scope.path}${scope.path === '/' ? ' (Root)' : ''}`;
		case 'tag':
			return scope.tag;
	}
}

export function analyticsHref(scope: AnalyticsScope): string {
	const pathname = '/admin/analytics';
	const query = new URLSearchParams();
	setScope(query, scope);
	if (query.size === 0) return pathname;
	return `${pathname}?${query}`;
}

export function scopeValue(scope: AnalyticsScope): string {
	const query = new URLSearchParams();
	setScope(query, scope);
	return query.toString() || 'all';
}

export function setScope(query: URLSearchParams, scope: AnalyticsScope): void {
	query.delete('domain');
	query.delete('path');
	query.delete('tag');
	if (scope.kind === 'domain' || scope.kind === 'link') query.set('domain', scope.domain);
	if (scope.kind === 'link') query.set('path', scope.path);
	if (scope.kind === 'tag') query.set('tag', scope.tag);
}
