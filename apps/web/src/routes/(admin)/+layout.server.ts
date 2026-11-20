import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	return { title: locals.snapshot.configuration.site.title };
};
