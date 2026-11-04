import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	domains: Object.entries(locals.snapshot.domains).map(([domain, prepared]) => ({
		domain,
		links: Object.entries(prepared.links).map(([path, link]) => ({
			path,
			title: link.title,
			url: link.url,
			enabled: link.enabled,
			status_code: link.status_code
		}))
	}))
});
