import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

const allowedHosts = (process.env.GOTO_ALLOWED_HOSTS ?? '')
	.split(',')
	.map((host) => host.trim())
	.filter(Boolean);

export default defineConfig(({ command }) => {
	const connectSources: ('self' | 'ws:' | 'wss:')[] = ['self'];
	if (command === 'serve' && !process.env.VITEST) {
		connectSources.push('ws:', 'wss:');
	}

	return {
		plugins: [
			sveltekit({
				adapter: adapter(),
				compilerOptions: {
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				inlineStyleThreshold: 10240,
				csp: {
					directives: {
						'default-src': ['self'],
						'script-src': ['self'],
						'style-src': ['self', 'unsafe-inline'],
						'img-src': ['self'],
						'font-src': ['self'],
						'connect-src': connectSources,
						'object-src': ['none'],
						'base-uri': ['self'],
						'form-action': ['self'],
						'frame-ancestors': ['none']
					}
				}
			})
		],
		server: { allowedHosts },
		test: {
			include: ['src/**/*.test.ts'],
			environment: 'node',
			coverage: {
				provider: 'v8',
				include: ['src/**/*.ts'],
				exclude: ['src/**/*.test.ts']
			}
		}
	};
});
