import { STATUS_CODES } from 'node:http';
import errorPage from './error.html?raw';

export function renderPublicError(response: Response, origin: string, method: string): Response {
	const headers = new Headers(response.headers);
	headers.set('content-type', 'text/html; charset=utf-8');
	headers.set('x-content-type-options', 'nosniff');
	headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	headers.set(
		'content-security-policy',
		"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
	);

	const { status, statusText } = response;
	const options = { status, statusText, headers };
	if (method === 'HEAD') return new Response(null, options);

	const heading = status === 404 ? 'Not found' : (STATUS_CODES[status] ?? 'Request failed');
	const escapedOrigin = origin
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;');
	const html = errorPage
		.replaceAll('%error.heading%', () => heading)
		.replaceAll('%error.origin%', () => escapedOrigin);
	return new Response(html, options);
}
