import type { LinkConfiguration } from '../src/schema.js';

type LinkInput = Pick<LinkConfiguration, 'url'> & Partial<LinkConfiguration>;

export function configurationInput(
	links: Record<string, LinkInput> = { '/docs': { url: 'https://example.com/docs' } }
) {
	return {
		auth: { credentials: { username: 'admin', password: 'test-password' } },
		domains: { 'go.example.com': { links } }
	};
}
