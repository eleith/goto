import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import { LineCounter, parseAllDocuments } from 'yaml';
import { ConfigError, toConfigIssue } from './errors.js';
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
	return validateConfig(raw, options);
}

export function validateConfig(raw: unknown, options: ConfigOptions = {}): PreparedConfiguration {
	try {
		assertSafeInput(raw);
		const copy = structuredClone(raw);
		const env = options.env ?? process.env;
		defaultAppUrl(copy, env);
		const expanded = interpolate(copy, env);
		const defaulted = Value.Default(GotoConfigurationSchema, configurationReferences, expanded);
		assertArrayShapesPreserved(raw, defaulted);
		if (!Value.Check(GotoConfigurationSchema, configurationReferences, defaulted)) {
			const issues = [
				...Value.Errors(GotoConfigurationSchema, configurationReferences, defaulted)
			].map(toConfigIssue);
			throw new ConfigError(issues);
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

function defaultAppUrl(raw: Record<string, unknown>, env: ConfigEnvironment): void {
	if (!Object.hasOwn(raw, 'url')) raw.url = {};
	const url = raw.url;
	if (typeof url !== 'object' || url === null || Array.isArray(url)) return;
	if (Object.hasOwn(url, 'app')) return;
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
	(url as Record<string, unknown>).app =
		number === 80 ? 'http://localhost' : `http://localhost:${number}`;
}
