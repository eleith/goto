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
const validYaml = `url:
  app: https://admin.example.test
auth:
  secret: \${DUMMY_SECRET}
  credentials:
    username: admin
    password: \${DUMMY_PASSWORD}
link_defaults:
  status_code: 302
  forward_query: true
fallback:
  url: \${DUMMY_DESTINATION}
domains:
  go.example.test:
    link_defaults:
      status_code: 307
    root:
      url: \${DUMMY_DESTINATION}
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

	it('reports safe tag warnings on stderr and succeeds with a qualified stdout message', async () => {
		const source = `${validYaml}        tags: [Work, "\${DUMMY_TAG}", work]\n`;
		const privateTag = 'private-tag-do-not-print\u0000';
		await writeConfiguration('config/goto.yaml', source);
		const output = createOutput();

		expect(
			await runCli(['config', 'validate'], output, { cwd, env: { ...env, DUMMY_TAG: privateTag } })
		).toBe(0);
		expect(output.stdout).toHaveBeenCalledExactlyOnceWith(
			'Configuration is valid with warnings.\n'
		);
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith(
			'Configuration warnings\n  /domains/*/links/*/tags/1: Dropped tag: ASCII control characters are not allowed\n'
		);
		const diagnostic = output.stderr.mock.calls[0]?.[0];
		for (const sensitive of [
			...Object.values(env),
			'private-tag-do-not-print',
			'go.example.test',
			'/docs',
			source,
			cwd
		]) {
			expect(diagnostic).not.toContain(sensitive);
		}
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
			name: 'direct self-loop in resolved YAML',
			source: validYaml,
			environment: {
				...env,
				DUMMY_DESTINATION: `http://go.example.test:80/docs?private=${env.DUMMY_PASSWORD}`
			}
		},
		{
			name: 'invalid resolved session secret',
			source: validYaml,
			environment: { ...env, DUMMY_SECRET: 'too-short' }
		},
		{
			name: 'nonarray tags',
			source: `${validYaml}        tags: Work\n`,
			environment: env
		},
		{
			name: 'nonstring tag item',
			source: `${validYaml}        tags: [Work, 42]\n`,
			environment: env
		},
		{
			name: 'invalid appearance alongside dropped tags',
			source: `${validYaml}        tags: [., ""]\nappearance: false\n`,
			environment: env,
			issue: '\n  /appearance: Expected object\n'
		}
	])('reports $name without disclosing configuration', async ({ source, environment, issue }) => {
		await writeConfiguration('config/goto.yaml', source);
		const output = createOutput();

		expect(await runCli(['config', 'validate'], output, { cwd, env: environment })).toBe(1);
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith(
			expect.stringMatching(/^Configuration validation failed\.\n/)
		);
		const diagnostic = output.stderr.mock.calls[0]?.[0];
		if (issue !== undefined) expect(diagnostic).toContain(issue);
		for (const sensitive of [...Object.values(env), ...Object.values(environment)]) {
			if (sensitive !== undefined) expect(diagnostic).not.toContain(sensitive);
		}
		expect(diagnostic).not.toContain(source);
		expect(diagnostic).not.toContain(cwd);
		expect(diagnostic).not.toContain('config/goto.yaml');
	});

	it('rejects the removed site section without printing its custom title', async () => {
		const oldTitle = 'Private title not for diagnostics';
		await writeConfiguration('config/goto.yaml', `${validYaml}site:\n  title: ${oldTitle}\n`);
		const output = createOutput();

		expect(await runCli(['config', 'validate'], output, { cwd, env })).toBe(1);
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith(
			expect.stringMatching(
				/^Configuration validation failed\.\n {2}\/: Unexpected property\.[^\n]*\n$/
			)
		);
		expect(output.stderr.mock.calls[0]?.[0]).not.toContain(oldTitle);
	});

	it('reports a missing file without disclosing the path', async () => {
		const output = createOutput();

		expect(
			await runCli(['config', 'validate', 'missing-private-path.yaml'], output, { cwd, env })
		).toBe(1);
		expect(output.stdout).not.toHaveBeenCalled();
		expect(output.stderr).toHaveBeenCalledExactlyOnceWith(
			'Configuration validation failed.\n  /: Unable to read configuration file\n'
		);
		const diagnostic = output.stderr.mock.calls[0]?.[0];
		expect(diagnostic).not.toContain('missing-private-path.yaml');
		expect(diagnostic).not.toContain(cwd);
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
