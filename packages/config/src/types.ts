import type { ConfigIssue } from './errors.js';
import type {
	GotoConfiguration,
	LinkConfiguration,
	RedirectResponse,
	RedirectStatus
} from './schema.js';

export type ConfigEnvironment = Readonly<Record<string, string | undefined>>;

export interface ConfigOptions {
	env?: ConfigEnvironment;
	cwd?: string;
}

export type SettingSource = 'builtin' | 'global' | 'domain' | 'link';

export type PreparedLink = Omit<
	LinkConfiguration,
	| 'title'
	| 'status_code'
	| 'forward_query'
	| 'case_insensitive'
	| 'ignore_trailing_slash'
	| 'forward_path'
> & {
	title: string;
	status_code: RedirectStatus;
	forward_query: boolean;
	case_insensitive: boolean;
	ignore_trailing_slash: boolean;
	forward_path: boolean;
	provenance: {
		status_code: SettingSource;
		forward_query: SettingSource;
		case_insensitive: SettingSource;
		ignore_trailing_slash: SettingSource;
		forward_path: SettingSource;
	};
};

export interface PreparedDomain {
	root: RedirectResponse | null;
	fallback: RedirectResponse | null;
	provenance: { fallback: SettingSource };
	links: Record<string, PreparedLink>;
	caseInsensitivePaths: Record<string, string>;
}

export interface PreparedConfiguration {
	configuration: GotoConfiguration;
	domains: Record<string, PreparedDomain>;
	warnings: readonly ConfigIssue[];
}
