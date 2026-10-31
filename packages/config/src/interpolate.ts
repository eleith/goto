import { ConfigError } from './errors.js';
import type { ConfigEnvironment } from './types.js';

const environmentPattern = /\$\$|\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g;
export const environmentTokenPattern = '(?:^|[^$])(?:\\$\\$)*\\$\\{[A-Z_][A-Z0-9_]*(?::-[^}]*)?\\}';

export function interpolate(node: unknown, env: ConfigEnvironment): unknown {
	if (typeof node === 'string') {
		return node.replace(
			environmentPattern,
			(match, name: string | undefined, fallback: string | undefined) => {
				if (match === '$$') return '$';
				const replacement = name !== undefined && Object.hasOwn(env, name) ? env[name] : undefined;
				if (replacement !== undefined) return replacement;
				if (fallback !== undefined) return fallback;
				throw new ConfigError();
			}
		);
	}
	if (Array.isArray(node)) return node.map((value) => interpolate(value, env));
	if (typeof node !== 'object' || node === null) return node;
	return Object.fromEntries(
		Object.entries(node).map(([key, value]) => [key, interpolate(value, env)])
	);
}
