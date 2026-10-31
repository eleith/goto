import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import { parseAllDocuments } from 'yaml';
import { ConfigError } from './errors.js';
import { assertArrayShapesPreserved, assertSafeInput } from './input.js';
import { interpolate } from './interpolate.js';
import { resolveConfigPath, resolveDeploymentRoot } from './paths.js';
import { prepareDomains } from './resolve.js';
import { GotoConfigurationSchema, configurationReferences } from './schema.js';
import type { ConfigEnvironment, ConfigOptions, PreparedConfiguration } from './types.js';

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
		throw new ConfigError();
	}
	const prepared = parseConfig(source, options);
	prepared.configuration.database.path = resolve(
		resolveDeploymentRoot(configPath),
		prepared.configuration.database.path
	);
	return prepared;
}

export function parseConfig(source: string, options: ConfigOptions = {}): PreparedConfiguration {
	let raw: unknown;
	try {
		const documents = parseAllDocuments(source, {
			version: '1.2',
			schema: 'core',
			stringKeys: true,
			uniqueKeys: true,
			merge: false,
			prettyErrors: false,
			logLevel: 'silent'
		});
		const document = documents[0];
		if (
			documents.length !== 1 ||
			!document ||
			document.errors.length > 0 ||
			document.warnings.length > 0 ||
			document.directives?.yaml.version !== '1.2'
		) {
			throw new ConfigError();
		}
		raw = document.toJS({ maxAliasCount: 100 });
	} catch {
		throw new ConfigError();
	}
	return validateConfig(raw, options);
}

export function validateConfig(raw: unknown, options: ConfigOptions = {}): PreparedConfiguration {
	try {
		assertSafeInput(raw);
		const copy = structuredClone(raw);
		const env = options.env ?? process.env;
		defaultSiteUrl(copy, env);
		const expanded = interpolate(copy, env);
		const defaulted = Value.Default(GotoConfigurationSchema, configurationReferences, expanded);
		assertArrayShapesPreserved(raw, defaulted);
		if (!Value.Check(GotoConfigurationSchema, configurationReferences, defaulted)) {
			throw new ConfigError();
		}
		const configuration = defaulted;
		const authoredDefaults =
			typeof raw.defaults === 'object' && raw.defaults !== null ? raw.defaults : {};
		return { configuration, domains: prepareDomains(configuration, authoredDefaults) };
	} catch (error) {
		if (error instanceof ConfigError) throw error;
		throw new ConfigError();
	}
}

function defaultSiteUrl(raw: Record<string, unknown>, env: ConfigEnvironment): void {
	if (!Object.hasOwn(raw, 'site')) raw.site = {};
	const site = raw.site;
	if (typeof site !== 'object' || site === null || Array.isArray(site)) return;
	if (Object.hasOwn(site, 'url')) return;
	const port = env.PORT ?? (env.NODE_ENV === 'development' ? '5173' : '3000');
	const number = Number(port);
	if (
		port.length === 0 ||
		/[^0-9]/.test(port) ||
		!Number.isInteger(number) ||
		number < 1 ||
		number > 65535 ||
		env.SOCKET_PATH ||
		Number(env.LISTEN_FDS) > 0
	) {
		throw new ConfigError();
	}
	(site as Record<string, unknown>).url =
		number === 80 ? 'http://localhost' : `http://localhost:${number}`;
}
