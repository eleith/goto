import type { GotoConfiguration, LinkConfiguration, RedirectStatus } from './schema.js';

export type ConfigEnvironment = Readonly<Record<string, string | undefined>>;

export interface ConfigOptions {
	env?: ConfigEnvironment;
	cwd?: string;
}

export type SettingSource = 'builtin' | 'global' | 'domain' | 'link';

export type PreparedLink = Omit<LinkConfiguration, 'title' | 'status_code' | 'forward_query'> & {
	title: string;
	status_code: RedirectStatus;
	forward_query: boolean;
	provenance: {
		status_code: SettingSource;
		forward_query: SettingSource;
	};
};

export interface PreparedDomain {
	fallback: GotoConfiguration['defaults']['fallback'];
	provenance: { fallback: SettingSource };
	links: Record<string, PreparedLink>;
}

export interface PreparedConfiguration {
	configuration: GotoConfiguration;
	domains: Record<string, PreparedDomain>;
}
