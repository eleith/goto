export function serverEnvironment(): NodeJS.ProcessEnv {
	return {
		PATH: process.env.PATH,
		NODE_ENV: 'production',
		TZ: 'UTC'
	};
}
