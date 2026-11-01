import { normalizeHost } from '@goto/config';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

function hasControlCharacters(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
}

function hasDuplicateHeader(request: IncomingMessage, name: string): boolean {
	let count = 0;
	for (let index = 0; index < request.rawHeaders.length; index += 2) {
		if (request.rawHeaders[index]?.toLowerCase() === name) count += 1;
	}
	return count > 1;
}

function readHeader(request: IncomingMessage, name: string): string | undefined {
	if (!name) return undefined;
	const value = request.headers[name];
	if (Array.isArray(value) || hasDuplicateHeader(request, name)) throw new Error();
	if (value === undefined) return;
	if (value.includes(',') || hasControlCharacters(value) || !value.isWellFormed()) {
		throw new Error();
	}
	return value;
}

function isAuthority(value: string): boolean {
	if (/[\s/?#@\\,]/.test(value) || hasControlCharacters(value) || !value.isWellFormed()) {
		return false;
	}
	return /^(?:\[[^\]]+\]|[^:[\]]+)(?::[0-9]+)?$/.test(value);
}

export function readIngress(
	request: IncomingMessage,
	env: NodeJS.ProcessEnv = process.env,
	defaultProtocol: 'http' | 'https' = 'https'
): { url: URL; host: string } | undefined {
	try {
		if (hasDuplicateHeader(request, 'host')) return undefined;

		const protocolHeader = (env.PROTOCOL_HEADER ?? '').toLowerCase();
		const hostHeader = (env.HOST_HEADER ?? '').toLowerCase();
		const portHeader = (env.PORT_HEADER ?? '').toLowerCase();
		const protocol = decodeURIComponent(
			readHeader(request, protocolHeader) || defaultProtocol
		).toLowerCase();
		if (protocol !== 'http' && protocol !== 'https') return undefined;

		const authority = readHeader(request, hostHeader) || readHeader(request, 'host');
		if (!authority || !isAuthority(authority)) return undefined;

		const port = readHeader(request, portHeader);
		if (port && !/^[0-9]+$/.test(port)) return undefined;
		const originAuthority = port ? `${authority}:${port}` : authority;
		if (!isAuthority(originAuthority)) return undefined;
		const host = normalizeHost(originAuthority);
		if (!host || host.includes(',')) return undefined;

		const target = request.url;
		if (
			!target?.startsWith('/') ||
			/[\s#\\]/.test(target) ||
			hasControlCharacters(target) ||
			!target.isWellFormed()
		) {
			return undefined;
		}

		const url = new URL(`${protocol}://${originAuthority}${target}`);
		return { url, host };
	} catch {
		return undefined;
	}
}

function isLoopbackAddress(address: string | undefined): boolean {
	if (!address) return false;
	if (isIP(address) === 4) return address.startsWith('127.');
	if (isIP(address) !== 6) return false;

	try {
		const hostname = new URL(`http://[${address}]/`).hostname;
		return hostname === '[::1]' || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(hostname);
	} catch {
		return false;
	}
}

export function isLocalProbe(request: IncomingMessage, url: URL): boolean {
	if (request.method !== 'GET' && request.method !== 'HEAD') return false;
	if (url.pathname !== '/healthz') return false;

	const hostname = url.hostname;
	const address = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
	return (
		(hostname === 'localhost' || isLoopbackAddress(address)) &&
		isLoopbackAddress(request.socket.remoteAddress)
	);
}
