export {
	ConfigError,
	formatConfigError,
	formatConfigWarnings,
	type ConfigIssue
} from './errors.js';
export { loadConfig, loadConfigFile, parseConfig } from './load.js';
export { startConfigReloading } from './monitor.js';
export { matchLink } from './matching.js';
export { isSelfRedirect } from './redirect.js';
export {
	isCanonicalPath,
	normalizeHost,
	reservedStaticPrefix,
	resolveConfigPath,
	resolveDeploymentRoot
} from './paths.js';
export {
	GotoConfigurationSchema,
	configurationReferences,
	type GotoConfiguration,
	type LinkConfiguration,
	type DomainConfiguration,
	type RedirectStatus,
	type RedirectResponse,
	type RedirectRule
} from './schema.js';
export type {
	ConfigEnvironment,
	ConfigOptions,
	PreparedConfiguration,
	PreparedDomain,
	PreparedLink,
	SettingSource
} from './types.js';
