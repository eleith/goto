export function linkHref(domain: string, path: string): string {
	const base = `/admin/domains/${encodeURIComponent(domain)}/links`;
	if (path === '/') return base;
	const segments = path.slice(1).split('/').map(encodeURIComponent);
	return `${base}/${segments.join('/')}`;
}

export function tagHref(tag: string): string {
	return `/admin/tags/${encodeURIComponent(tag)}`;
}
