import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	origin: locals.snapshot?.configuration.url.app ?? null
});
