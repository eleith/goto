import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './cli.js';

const env = {
	DUMMY_PASSWORD: 'dummy-password-do-not-print',
	DUMMY_SECRET: 'dummy-session-secret-with-at-least-thirty-two-characters-do-not-print',
	DUMMY_DESTINATION: 'https://destination.example.test/private-do-not-print'
};
const validYaml = `site:
  url: https://admin.example.test
auth:
  secret: \${DUMMY_SECRET}
  credentials:
    username: admin
    password: \${DUMMY_PASSWORD}
domains:
  go.example.test:
    links:
      /docs:
        url: \${DUMMY_DESTINATION}
`;

let cwd: string;

function createOutput() {
	return { stdout: vi.fn(), stderr: vi.fn() };
}

async function writeConfiguration(path = 'config/goto.yaml', source = validYaml) {
	const absolutePath = join(cwd, path);
	await mkdir(dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, source);
}

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), 'goto-cli-'));
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

describe('goto-cli config validate', () => {
	it.each([
		{ name: 'root', args: ['--help'] },
		{ name: 'config', args: ['config', '--help'] },
		{ name: 'validate', args: ['config', 'validate', '--help'] }
	])('shows $name help without requiring a configuration or environment', async ({ args }) => {
		const output = createOutput();

		expect(await runCli(args, output, { cwd, env: {} })).toBe(0);
		expect(output.stderr).not.toHaveBeenCalled();
		expect(output.stdout).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('goto-cli'));
		expect(output.stdout).toHaveBeenCalledWith(
			expect.stringContaining('including environment interpolation')
		);
		expect(output.stdout).toHaveBeenCalledWith(expect.stringContaining('config/goto.yaml'));
	});

	it.each([
		{
			name: 'default path',
			args: ['config', 'validate'],
			path: 'config/goto.yaml',
			pathEnv: {}
		},
		{
			name: 'CONFIG_PATH relative to cwd',
			args: ['config', 'validate'],
			path: 'deployment/custom.yaml',
			pathEnv: { CONFIG_PATH: 'deployment/custom.yaml' }
		},
		{
			name: 'explicit path overriding CONFIG_PATH',
			args: ['config', 'validate', 'deployment/explicit.yaml'],
			path: 'deployment/explicit.yaml',
			pathEnv: { CONFIG_PATH: 'missing-do-not-print.yaml' }
		},
		{
			name: 'initial package-manager separator',
			args: ['--', 'config', 'validate', 'deployment/explicit.yaml'],
			path: 'deployment/explicit.yaml',
			pathEnv: { CONFIG_PATH: 'missing-do-not-print.yaml' }
		}
	])('validates resolved values using $name', async ({ args, path, pathEnv }) => {
		await writeConfiguration(path);
		const output = createOutput();

		expect(await runCli(Object.freeze(args), output, { cwd, env: { ...env, ...pathEnv } })).toBe(0);
		expect(output.stdout).toHaveBeenCalledExactlyOnceWith('Configuration is valid.\n');
		expect(output.stderr).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: 'invalid YAML with a secret parser snippet',
			source: `auth: [${env.DUMMY_SECRET}`,
			environment: env
		},
		{
			name: 'invalid authored field containing a secret key',
			source: `${validYaml}\n${env.DUMMY_SECRET}: ${env.DUMMY_PASSWORD}\n`,
			environment: env
		},
		{
			name: 'missing required variable',
			source: validYaml,
			environment: { ...env, DUMMY_PASSWORD: undefined }
		},
		{
			name: 'invalid resolved destination',
			source: validYaml,
			environment: { ...env, DUMMY_DESTINATION: `not-a-url-${env.DUMMY_PASSWORD}` }
		},
		{
			name: 'invalid resolved session secret',
			source: validYaml,
			environment: { ...env, DUMMY_SECRET: 'too-short' }
		}
	])('reports $name without disclosing configuration', async ({ source, environment }) => {
		await writeConfiguration('config/goto.yaml', source);
		const output = createOutput();

		expect(await runCli(['config', 'validate'], output, { cwd, env: environment })).toBe(1);
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith('Configuration validation failed.\n');
	});

	it('reports a missing file without disclosing the path', async () => {
		const output = createOutput();

		expect(
			await runCli(['config', 'validate', 'missing-private-path.yaml'], output, { cwd, env })
		).toBe(1);
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith('Configuration validation failed.\n');
	});

	it.each([
		{ name: 'missing command', args: [] },
		{ name: 'missing config subcommand', args: ['config'] },
		{ name: 'unknown command', args: ['do-not-print-command'] },
		{ name: 'unknown config subcommand', args: ['config', 'do-not-print-command'] },
		{ name: 'unknown option', args: ['config', 'validate', '--do-not-print-option'] },
		{ name: 'unsupported validation mode', args: ['config', 'validate', '--check-env'] },
		{
			name: 'extra positional',
			args: ['config', 'validate', 'config/goto.yaml', 'do-not-print-extra']
		},
		{ name: 'empty path', args: ['config', 'validate', ''] },
		{ name: 'extra separator', args: ['config', 'validate', '--', 'config/goto.yaml'] }
	])('rejects $name without echoing arguments or invalid fields', async ({ args }) => {
		await writeConfiguration(
			'config/goto.yaml',
			`${validYaml}\n${env.DUMMY_SECRET}: ${env.DUMMY_PASSWORD}\n`
		);
		const output = createOutput();

		expect(await runCli(args, output, { cwd, env })).toBe(1);
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith(
			'Command failed. Run goto-cli --help for usage.\n'
		);
	});
});
