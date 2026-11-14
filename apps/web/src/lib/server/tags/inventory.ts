import type { PreparedLink } from '@goto/config';
import type { ConfigurationSnapshot, Immutable } from '../snapshot.js';

export function currentTags(domains: ConfigurationSnapshot['domains']): string[] {
	const tags = new Set<string>();
	for (const domain of Object.values(domains)) {
		for (const link of Object.values(domain.links)) {
			for (const tag of link.tags) tags.add(tag);
		}
	}
	return [...tags].sort();
}

export function tagMembers(
	domains: ConfigurationSnapshot['domains'],
	tag: string
): Array<{ domain: string; path: string; link: Immutable<PreparedLink> }> {
	const members: Array<{ domain: string; path: string; link: Immutable<PreparedLink> }> = [];
	for (const [domain, prepared] of Object.entries(domains)) {
		for (const [path, link] of Object.entries(prepared.links)) {
			if (link.tags.includes(tag)) members.push({ domain, path, link });
		}
	}
	return members;
}
