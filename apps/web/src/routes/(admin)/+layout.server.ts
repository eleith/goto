import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	return { title: locals.snapshot.configuration.site.title };
};
