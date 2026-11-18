import nodeAdapter from '@sveltejs/adapter-node';
import type { Adapter } from '@sveltejs/kit';
import { fileURLToPath } from 'node:url';
import { DevelopmentServer } from './development.ts';
import { configureVite } from './plugins.ts';

const entry = fileURLToPath(new URL('../src/lib/server/entry.ts', import.meta.url));
const applicationFiles = [
	'application.ts',
	'visits/writer.ts',
	'visits/writer-thread.ts',
	'visits/counts.ts'
].map((file) => fileURLToPath(new URL(`../src/lib/server/${file}`, import.meta.url)));

export default function adapter(): Adapter {
	const node = nodeAdapter();
	const development = new DevelopmentServer(entry, applicationFiles);
	return {
		...node,
		emulate: () => development.emulate(node.emulate),
		vite: configureVite(node.vite, development, entry)
	};
}
