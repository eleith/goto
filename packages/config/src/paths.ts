import { dirname, resolve } from 'node:path';
import { hasControlCharacters } from './text.js';
import type { ConfigOptions } from './types.js';

export const reservedStaticPrefix = '/@static/';

export function resolveConfigPath(options: ConfigOptions = {}): string {
	const env = options.env ?? process.env;
	return resolve(options.cwd ?? process.cwd(), env.CONFIG_PATH ?? 'config/goto.yaml');
}

export function resolveDeploymentRoot(configPath: string): string {
	return dirname(dirname(resolve(configPath)));
}

export function isCanonicalPath(path: string): boolean {
	if (!path.startsWith('/') || path.startsWith('//')) return false;
	if (path !== '/' && path.endsWith('/')) return false;
	if (/[ :?#[\]\\]/.test(path) || hasControlCharacters(path) || !path.isWellFormed()) return false;
	return !path.split('/').some((segment) => segment === '.' || segment === '..');
}

export function normalizeHost(host: string): string | undefined {
	if (/[\s/?#@\\]/.test(host)) return undefined;
	try {
		const url = new URL(`https://${host}`);
		if (!url.host || url.port === '0') return undefined;
		return url.host;
	} catch {
		return undefined;
	}
}
