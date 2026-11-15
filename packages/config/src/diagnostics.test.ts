import { describe, expect, it } from 'vitest';
import { configurationInput } from '../test/configuration.js';
import {
	ConfigError,
	formatConfigError,
	formatConfigWarnings,
	parseConfig,
	loadConfig
} from './index.js';

const options = { env: {} };
const privateKey = 'private-authored-key-marker/~secret';
const privateValue = 'private-authored-value-marker';

function captureConfigError(action: () => unknown): ConfigError {
	try {
		action();
	} catch (error) {
		if (error instanceof ConfigError) return error;
		throw error;
	}
	throw new Error('Expected configuration to fail');
}

describe('configuration diagnostics', () => {
	it('keeps the error message generic and formats issues only when requested', () => {
		const issues = [{ path: '/site', message: 'Expected object' }];
		const error = new ConfigError(issues);
		expect(error.message).toBe('Invalid configuration');
		expect(String(error)).toBe('ConfigError: Invalid configuration');
		expect(error.issues).toEqual(issues);
		expect(error).not.toHaveProperty('cause');
		expect(formatConfigError(error)).toBe('Invalid configuration\n  /site: Expected object');
		expect(formatConfigError(error, 'Configuration validation failed.')).toBe(
			'Configuration validation failed.\n  /site: Expected object'
		);
		expect(new ConfigError().issues).toEqual([]);
		expect(formatConfigError(new ConfigError())).toBe('Invalid configuration');
		expect(formatConfigError(new ConfigError(), 'Configuration validation failed.')).toBe(
			'Configuration validation failed.'
		);
	});

	it('formats tag warnings with masked locations and static reasons without configuration values', () => {
		const prepared = loadConfig(
			{
				...configurationInput(),
				domains: {
					'private-domain-marker.example.com': {
						links: {
							'/private-link-marker': {
								url: 'https://example.com',
								tags: ['Work', `${privateValue}\u0000`]
							}
						}
					}
				}
			},
			options
		);
		const warnings = Object.freeze(prepared.warnings);
		expect(warnings).toEqual([
			{
				path: '/domains/*/links/*/tags/1',
				message: 'Dropped tag: ASCII control characters are not allowed'
			}
		]);
		expect(formatConfigWarnings(warnings)).toBe(
			'Configuration warnings\n  /domains/*/links/*/tags/1: Dropped tag: ASCII control characters are not allowed'
		);
		expect(formatConfigWarnings([])).toBe('Configuration warnings');
		for (const output of [JSON.stringify(warnings), formatConfigWarnings(warnings)]) {
			expect(output).not.toContain('private-domain-marker');
			expect(output).not.toContain('private-link-marker');
			expect(output).not.toContain(privateValue);
		}
	});

	it('identifies the site section and its allowed fields without echoing the old URL', () => {
		const error = captureConfigError(() =>
			loadConfig(
				{
					...configurationInput(),
					site: { url: `https://${privateValue}.example.com` }
				},
				options
			)
		);
		expect(error.message).toBe('Invalid configuration');
		expect(error.issues).toEqual([
			{
				path: '/site',
				message: 'Unexpected property. Allowed fields: title, logo_path, favicon_path'
			}
		]);
		expect(JSON.stringify(error)).not.toContain(privateValue);
		expect(formatConfigError(error)).not.toContain(privateValue);
	});

	it.each([
		{ override: { [privateKey]: privateValue }, path: '/' },
		{ override: { site: { [privateKey]: privateValue } }, path: '/site' }
	])('omits unknown property names and values at $path', ({ override, path }) => {
		const error = captureConfigError(() =>
			loadConfig({ ...configurationInput(), ...override }, options)
		);
		expect(error.issues).toEqual([
			{ path, message: expect.stringContaining('Unexpected property') }
		]);
		for (const output of [JSON.stringify(error), formatConfigError(error)]) {
			expect(output).not.toContain('private-authored-key-marker');
			expect(output).not.toContain(privateValue);
		}
	});

	it('redacts domain and link keys and reports invalid resolved values without printing them', () => {
		const error = captureConfigError(() =>
			loadConfig(
				{
					...configurationInput(),
					domains: {
						'private-domain-marker.example.com': {
							links: {
								'/private-link-marker': {
									url: '${DESTINATION}',
									[privateKey]: privateValue
								}
							}
						}
					}
				},
				{ env: { DESTINATION: `https://user:${privateValue}@example.com` } }
			)
		);
		expect(error.issues).toContainEqual({
			path: '/domains/*/links/*/url',
			message: "Expected string to match 'goto-link-url' format"
		});
		expect(error.issues).toContainEqual({
			path: '/domains/*/links/*',
			message: expect.stringContaining('Unexpected property. Allowed fields: url, redirect, title')
		});
		for (const output of [JSON.stringify(error), formatConfigError(error)]) {
			for (const marker of [
				'private-domain-marker',
				'private-link-marker',
				'private-authored-key-marker',
				privateValue,
				'${DESTINATION}'
			]) {
				expect(output).not.toContain(marker);
			}
		}
	});

	it('keeps conditional routing failures fatal with masked rule locations and no authored values', () => {
		const error = captureConfigError(() =>
			loadConfig(
				{
					...configurationInput(),
					domains: {
						'private-domain-marker.example.com': {
							links: {
								'/private-link-marker': {
									url: 'https://example.com',
									redirect: [
										{
											if: { language: 'fr', [privateKey]: privateValue },
											to: `https://user:${privateValue}@example.com`
										}
									]
								}
							}
						}
					}
				},
				options
			)
		);
		expect(error.issues).toContainEqual({
			path: '/domains/*/links/*/redirect/0/to',
			message: "Expected string to match 'goto-link-url' format"
		});
		expect(error.issues).toContainEqual({
			path: '/domains/*/links/*/redirect/0/if',
			message: 'Unexpected property. Allowed fields: language, os'
		});
		for (const output of [JSON.stringify(error), formatConfigError(error)]) {
			expect(output).not.toContain('private-domain-marker');
			expect(output).not.toContain('private-link-marker');
			expect(output).not.toContain('private-authored-key-marker');
			expect(output).not.toContain(privateValue);
		}
	});

	it('keeps response diagnostics secret-safe and redacts their domain keys', () => {
		const error = captureConfigError(() =>
			loadConfig(
				{
					...configurationInput(),
					fallback: { url: `https://user:${privateValue}@example.com` },
					domains: {
						'private-domain-marker.example.com': {
							root: { url: `https://user:${privateValue}@example.com` },
							fallback: { url: 'https://example.com', [privateKey]: privateValue },
							links: {}
						}
					}
				},
				options
			)
		);
		expect(error.message).toBe('Invalid configuration');
		expect(error.issues).toContainEqual({
			path: '/fallback/url',
			message: "Expected string to match 'goto-link-url' format"
		});
		expect(error.issues).toContainEqual({
			path: '/domains/*/root/url',
			message: "Expected string to match 'goto-link-url' format"
		});
		expect(error.issues).toContainEqual({
			path: '/domains/*/fallback',
			message: 'Unexpected property. Allowed fields: url, status_code, forward_query'
		});
		for (const output of [JSON.stringify(error), formatConfigError(error)]) {
			expect(output).not.toContain('private-domain-marker');
			expect(output).not.toContain('private-authored-key-marker');
			expect(output).not.toContain(privateValue);
		}
	});

	it('reports YAML codes and line positions without parser snippets or authored keys', () => {
		const source = `${privateKey}: ${privateValue}\n${privateKey}: ${privateValue}`;
		const error = captureConfigError(() => parseConfig(source, options));
		expect(error.message).toBe('Invalid configuration');
		expect(error.issues).toEqual([
			{ path: '/', message: 'Invalid YAML (DUPLICATE_KEY) at line 2, column 1' }
		]);
		for (const output of [JSON.stringify(error), formatConfigError(error)]) {
			expect(output).not.toContain('private-authored-key-marker');
			expect(output).not.toContain(privateValue);
			expect(output).not.toContain(source);
		}
	});

	it('leaves errors without safe context generic', () => {
		const error = captureConfigError(() =>
			loadConfig({ ...configurationInput(), [privateKey]: '${MISSING}' }, options)
		);
		expect(error.issues).toEqual([]);
		expect(formatConfigError(error)).toBe('Invalid configuration');
		expect(JSON.stringify(error)).not.toContain('private-authored-key-marker');
	});
});
