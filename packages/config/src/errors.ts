import { ValueErrorType, type ValueError } from '@sinclair/typebox/value';

export interface ConfigIssue {
	path: string;
	message: string;
}

export class ConfigError extends Error {
	readonly issues: readonly ConfigIssue[];

	constructor(issues: readonly ConfigIssue[] = []) {
		super('Invalid configuration');
		this.name = 'ConfigError';
		this.issues = issues;
	}
}

export function toConfigIssue(error: ValueError): ConfigIssue {
	const segments = error.path.split('/').slice(1);
	let message = error.message;
	if (error.type === ValueErrorType.ObjectAdditionalProperties) {
		segments.pop();
		const allowedFields = Object.keys(error.schema.properties ?? {});
		message =
			allowedFields.length > 0
				? `Unexpected property. Allowed fields: ${allowedFields.join(', ')}`
				: 'Unexpected property';
	}
	if (segments[0] === 'domains') {
		if (segments.length > 1) segments[1] = '*';
		if (segments[2] === 'links' && segments.length > 3) segments[3] = '*';
	}
	return { path: `/${segments.join('/')}`, message };
}

export function formatConfigError(error: ConfigError, headline = error.message): string {
	return [headline, ...error.issues.map((issue) => `  ${issue.path}: ${issue.message}`)].join('\n');
}

export function formatConfigWarnings(warnings: readonly ConfigIssue[]): string {
	return [
		'Configuration warnings',
		...warnings.map((issue) => `  ${issue.path}: ${issue.message}`)
	].join('\n');
}
