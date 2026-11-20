import { reservedStaticPrefix } from './paths.js';

const reservedRouteSegments = new Set(['admin', 'auth', 'signin', '_app']);
const reservedEndpoints = new Set([
	'/healthz',
	'/schema.json',
	'/@vite/client',
	'/@vite/env',
	'/__open-in-editor',
	'/.well-known/appspecific/com.chrome.devtools.json'
]);
const reservedPrefixes = [
	reservedStaticPrefix,
	'/@id/',
	'/@fs/',
	'/src/routes/',
	'/src/lib/',
	'/.svelte-kit/generated/',
	'/node_modules/.vite/'
];

export function isReservedLinkPath(path: string): boolean {
	const firstSegment = path.split('/', 2)[1] ?? '';
	if (reservedRouteSegments.has(firstSegment)) return true;

	const withoutTrailingSlash = path.endsWith('/') ? path.slice(0, -1) : path;
	if (reservedEndpoints.has(withoutTrailingSlash)) return true;

	return reservedPrefixes.some((prefix) => path.startsWith(prefix));
}
