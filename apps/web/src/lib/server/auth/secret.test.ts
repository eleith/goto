import { afterEach, expect, test, vi } from 'vitest';
import { resolveAuthSecret } from './secret.js';

afterEach(() => vi.unstubAllEnvs());

test('uses the configured secret unchanged', () => {
	const configured = 'configured-secret-with-at-least-thirty-two-characters';
	expect(resolveAuthSecret(configured)).toBe(configured);
});

test('omission generates a key instead of inheriting ambient auth secrets', () => {
	const ambient = 'ambient-secret-with-at-least-thirty-two-characters';
	vi.stubEnv('AUTH_SECRET', ambient);
	vi.stubEnv('BETTER_AUTH_SECRET', ambient);

	const generated = resolveAuthSecret();

	expect(generated.length).toBeGreaterThanOrEqual(32);
	expect(generated).not.toBe(ambient);
});
