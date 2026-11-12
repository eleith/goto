import { describe, expect, it } from 'vitest';
import { configurationInput } from '../test/configuration.js';
import { ConfigError, formatConfigError, parseConfig, validateConfig } from './index.js';

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

	it('identifies the site section and its allowed fields without echoing the old URL', () => {
		const error = captureConfigError(() =>
			validateConfig(
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
			validateConfig({ ...configurationInput(), ...override }, options)
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
			validateConfig(
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
			message: expect.stringContaining('Unexpected property. Allowed fields: url, title')
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
			validateConfig({ ...configurationInput(), [privateKey]: '${MISSING}' }, options)
		);
		expect(error.issues).toEqual([]);
		expect(formatConfigError(error)).toBe('Invalid configuration');
		expect(JSON.stringify(error)).not.toContain('private-authored-key-marker');
	});
});
