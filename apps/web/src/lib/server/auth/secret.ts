import { randomBytes } from 'node:crypto';

export function resolveAuthSecret(configured?: string): string {
	const secret = configured ?? randomBytes(32).toString('base64');
	if (secret.length < 32) {
		throw new Error('auth.secret must contain at least 32 characters');
	}
	return secret;
}
