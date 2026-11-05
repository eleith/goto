import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function resolve(specifier, context, nextResolve) {
	const relative = specifier.startsWith('./') || specifier.startsWith('../');
	if (relative && specifier.endsWith('.js') && context.parentURL) {
		const tsSpecifier = specifier.slice(0, -3) + '.ts';
		const tsUrl = new URL(tsSpecifier, context.parentURL);
		if (existsSync(fileURLToPath(tsUrl))) {
			return nextResolve(tsSpecifier, context);
		}
	}
	return nextResolve(specifier, context);
}
