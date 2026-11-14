import type { ConfigIssue } from './errors.js';
import { hasControlCharacters } from './text.js';

export function dropInvalidStringTags(value: unknown): ConfigIssue[] {
	const warnings: ConfigIssue[] = [];
	if (!isObject(value) || !isObject(value.domains)) return warnings;
	for (const domain of Object.values(value.domains)) {
		if (!isObject(domain) || !isObject(domain.links)) continue;
		for (const link of Object.values(domain.links)) {
			if (!isObject(link) || !Array.isArray(link.tags)) continue;
			link.tags = link.tags.filter((tag: unknown, index: number) => {
				if (typeof tag !== 'string') return true;
				const reason = invalidTagReason(tag);
				if (reason === undefined) return true;
				warnings.push({ path: `/domains/*/links/*/tags/${index}`, message: reason });
				return false;
			});
		}
	}
	return warnings;
}

function invalidTagReason(tag: string): string | undefined {
	if (!/\S/.test(tag)) return 'Dropped tag: expected nonblank text';
	if (tag === '.' || tag === '..') return 'Dropped tag: dot segments are not allowed';
	if (hasControlCharacters(tag)) return 'Dropped tag: ASCII control characters are not allowed';
	if (!tag.isWellFormed()) return 'Dropped tag: malformed Unicode is not allowed';
	return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
