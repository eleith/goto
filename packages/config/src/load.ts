import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import { LineCounter, parseAllDocuments } from 'yaml';
import { ConfigError } from './errors.js';
import { assertArrayShapesPreserved, assertSafeInput } from './input.js';
import { interpolate } from './interpolate.js';
import { resolveConfigPath, resolveDeploymentRoot } from './paths.js';
import { buildRedirectDomainLookup } from './resolve.js';
import { GotoConfigurationSchema, configurationReferences } from './schema.js';
import { dropInvalidStringTags } from './tags.js';
import type { ConfigOptions, PreparedConfiguration } from './types.js';
import { validateConfig, validateRedirectDomainLookup } from './validation.js';

export async function loadConfigFile(
	path?: string,
	options: ConfigOptions = {}
): Promise<PreparedConfiguration> {
	const configPath =
		path === undefined ? resolveConfigPath(options) : resolve(options.cwd ?? process.cwd(), path);
	let source: string;
	try {
		source = await readFile(configPath, 'utf8');
	} catch {
		throw new ConfigError([{ path: '/', message: 'Unable to read configuration file' }]);
	}
	const prepared = parseConfig(source, options);
	const deploymentRoot = resolveDeploymentRoot(configPath);
	const database = prepared.configuration.database;
	database.path = resolve(deploymentRoot, database.path);
	database.worker_path = resolve(deploymentRoot, database.worker_path);
	return prepared;
}

export function parseConfig(source: string, options: ConfigOptions = {}): PreparedConfiguration {
	let raw: unknown;
	try {
		const lineCounter = new LineCounter();
		const documents = parseAllDocuments(source, {
			lineCounter,
			schema: 'core',
			stringKeys: true,
			uniqueKeys: true,
			merge: false,
			prettyErrors: false,
			logLevel: 'silent'
		});
		const document = documents[0];
		if (documents.length !== 1 || !document) {
			throw new ConfigError([{ path: '/', message: 'Expected one YAML document' }]);
		}
		const yamlErrors = [...document.errors, ...document.warnings];
		if (yamlErrors.length > 0) {
			const issues = yamlErrors.map((error) => {
				const { line, col } = lineCounter.linePos(error.pos[0]);
				return {
					path: '/',
					message: `Invalid YAML (${error.code}) at line ${line}, column ${col}`
				};
			});
			throw new ConfigError(issues);
		}
		raw = document.toJS({ maxAliasCount: 100 });
	} catch (error) {
		if (error instanceof ConfigError) throw error;
		throw new ConfigError();
	}
	return loadConfig(raw, options);
}

export function loadConfig(raw: unknown, options: ConfigOptions = {}): PreparedConfiguration {
	try {
		const { configuration, authoredLinkDefaults, warnings } = resolveConfigValues(raw, options);
		validateConfig(configuration);
		const domains = buildRedirectDomainLookup(configuration, authoredLinkDefaults);
		validateRedirectDomainLookup(domains);
		return { configuration, domains, warnings };
	} catch (error) {
		if (error instanceof ConfigError) throw error;
		throw new ConfigError();
	}
}

function resolveConfigValues(raw: unknown, options: ConfigOptions) {
	assertSafeInput(raw);
	const copy = structuredClone(raw);
	const env = options.env ?? process.env;
	if (env.NODE_ENV === 'development') defaultDevelopmentAppUrl(copy);
	const expanded = interpolate(copy, env);
	const configuration = Value.Default(GotoConfigurationSchema, configurationReferences, expanded);
	assertArrayShapesPreserved(raw, configuration);
	const warnings = dropInvalidStringTags(configuration);
	const authoredLinkDefaults =
		typeof raw.link_defaults === 'object' && raw.link_defaults !== null ? raw.link_defaults : {};
	return { configuration, authoredLinkDefaults, warnings };
}

function defaultDevelopmentAppUrl(raw: Record<string, unknown>): void {
	if (!Object.hasOwn(raw, 'url')) raw.url = {};
	const url = raw.url;
	if (typeof url !== 'object' || url === null || Array.isArray(url)) return;
	if (Object.hasOwn(url, 'app')) return;
	(url as Record<string, unknown>).app = 'http://localhost:5173';
}
