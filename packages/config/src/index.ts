export { ConfigError } from './errors.js';
export { loadConfigFile, parseConfig, validateConfig } from './load.js';
export { isSelfRedirect } from './redirect.js';
export {
	isCanonicalPath,
	normalizeHost,
	resolveConfigPath,
	resolveDeploymentRoot
} from './paths.js';
export {
	GotoConfigurationSchema,
	configurationReferences,
	type GotoConfiguration,
	type LinkConfiguration,
	type DomainConfiguration,
	type RedirectStatus
} from './schema.js';
export type {
	ConfigEnvironment,
	ConfigOptions,
	PreparedConfiguration,
	PreparedDomain,
	PreparedLink,
	SettingSource
} from './types.js';
