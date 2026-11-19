import { execFile } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { serverEnvironment } from './support/environment.ts';

const webDirectory = fileURLToPath(new URL('..', import.meta.url));

export default async function setup() {
	const runsDirectory = join(webDirectory, '.e2e');
	await mkdir(runsDirectory, { recursive: true });
	const directory = await mkdtemp(join(runsDirectory, 'run-'));
	const projectDirectory = join(directory, 'project');
	process.env.GOTO_E2E_BUILD_DIR = projectDirectory;
	const cleanup = () => rm(directory, { recursive: true, force: true });

	try {
		await mkdir(projectDirectory);
		for (const path of [
			'src',
			'static',
			'server',
			'server.js',
			'package.json',
			'vite.config.ts',
			'tsconfig.json'
		]) {
			await cp(join(webDirectory, path), join(projectDirectory, path), { recursive: true });
		}
		await symlink(
			join(webDirectory, 'node_modules'),
			join(projectDirectory, 'node_modules'),
			'dir'
		);
		await promisify(execFile)(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
			cwd: projectDirectory,
			env: serverEnvironment(),
			timeout: 120_000,
			maxBuffer: 10 * 1024 * 1024
		});
		await access(join(projectDirectory, 'build/handler.js'));
		await access(join(projectDirectory, 'build/server/goto-runtime.js'));
		await access(join(projectDirectory, 'server.js'));
		return cleanup;
	} catch (error) {
		await cleanup();
		throw error;
	}
}
