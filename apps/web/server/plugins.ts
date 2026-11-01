import type { Adapter, AdapterViteConfig } from '@sveltejs/kit';
import type { Plugin } from 'vite';
import type { DevelopmentServer } from './development.ts';

function developmentPlugin(server: DevelopmentServer): Plugin {
	return {
		name: 'goto-host-dispatch',
		apply: (_configuration, environment) => environment.command === 'serve' && !process.env.VITEST,
		enforce: 'pre',
		configureServer: (vite) => server.configure(vite),
		closeBundle: () => server.close()
	};
}

function runtimeEntryPlugin(entry: string): Plugin {
	return {
		name: 'goto-runtime-entry',
		apply: 'build',
		config() {
			return {
				environments: {
					ssr: {
						build: { rolldownOptions: { input: { 'goto-runtime': entry } } }
					}
				}
			};
		}
	};
}

function withRuntime(
	configuration: AdapterViteConfig,
	development: DevelopmentServer,
	entry: string
): AdapterViteConfig {
	const plugins = configuration.plugins;
	const pre = Array.isArray(plugins) ? plugins : (plugins?.pre ?? []);
	const post = Array.isArray(plugins) ? [] : (plugins?.post ?? []);
	return {
		...configuration,
		getRequest: (options) => development.request(options, configuration.getRequest),
		plugins: {
			pre: [developmentPlugin(development), ...pre],
			post: [...post, runtimeEntryPlugin(entry)]
		}
	};
}

export function configureVite(
	configuration: Adapter['vite'],
	development: DevelopmentServer,
	entry: string
): NonNullable<Adapter['vite']> {
	if (typeof configuration === 'function') {
		return (context) => withRuntime(configuration(context), development, entry);
	}
	return withRuntime(configuration ?? {}, development, entry);
}
