export class ConfigError extends Error {
	constructor() {
		super('Invalid configuration');
		this.name = 'ConfigError';
	}
}
