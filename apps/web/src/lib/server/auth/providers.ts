import { timingSafeEqual } from 'node:crypto';
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, formCsrfMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import type { GotoConfiguration } from '@goto/config';
import type { Immutable } from '../snapshot.js';

type CredentialsAuth = NonNullable<GotoConfiguration['auth']['credentials']>;
type OidcAuth = NonNullable<GotoConfiguration['auth']['oidc']>;
type AuthOptions = Pick<BetterAuthOptions, 'plugins' | 'onAPIError'>;

export function buildAuthOptions(cfg: Immutable<GotoConfiguration>): AuthOptions {
	if (cfg.auth.credentials) return credentialsAuth(cfg.auth.credentials, 'admin@goto.invalid');
	if (cfg.auth.oidc) return oidcAuth(cfg.auth.oidc, cfg.url.app);
	throw new Error('an authentication strategy is required');
}

function credentialsAuth(admin: CredentialsAuth, email: string): AuthOptions {
	return {
		plugins: [credentialsProvider(admin, email)]
	};
}

function oidcAuth(oidc: OidcAuth, appUrl: string): AuthOptions {
	return {
		plugins: [
			genericOAuth({
				config: [
					{
						providerId: 'oidc',
						name: oidc.name,
						discoveryUrl: `${oidc.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`,
						clientId: oidc.client_id,
						clientSecret: oidc.client_secret,
						tokenEndpointAuth: { method: 'client_secret_basic' },
						scopes: ['openid', 'profile', 'email'],
						pkce: true,
						requireIdTokenVerification: true,
						accountSubject: ({ tokens, profile }) => {
							if (!tokens.idToken) throw new Error('OIDC sign-in requires an ID token');
							return profile.sub ?? '';
						},
						disableProviderLogout: true
					}
				]
			})
		],
		onAPIError: { errorURL: new URL('/signin', appUrl).href }
	};
}

function credentialsProvider(admin: CredentialsAuth, email: string): BetterAuthPlugin {
	return {
		id: 'goto-credentials',
		endpoints: {
			signInCredentials: createAuthEndpoint(
				'/sign-in/credentials',
				{ method: 'POST', use: [formCsrfMiddleware] },
				async (ctx) => {
					const identity = verifyCredentials(admin, ctx.body);
					if (!identity) {
						throw new APIError('UNAUTHORIZED', {
							code: 'CredentialsSignin',
							message: 'Invalid username or password'
						});
					}

					// The default adapter is ephemeral; the password never enters it.
					const adapter = ctx.context.internalAdapter;
					const existing = await adapter.findUserByEmail(email);
					let user = existing?.user;
					if (!user) {
						user = await adapter.createUser(
							{ name: identity.name, email, emailVerified: true },
							{ method: 'goto-credentials' }
						);
					}
					const session = await adapter.createSession(user.id);
					if (!session) throw new APIError('INTERNAL_SERVER_ERROR');
					await setSessionCookie(ctx, { session, user });
					return ctx.json({ success: true });
				}
			)
		}
	};
}

export function verifyCredentials(
	admin: CredentialsAuth,
	submitted: unknown
): { id: string; name: string } | null {
	if (typeof submitted !== 'object' || submitted === null) return null;
	const fields = submitted as Record<string, unknown>;
	const username = typeof fields.username === 'string' ? fields.username : '';
	const password = typeof fields.password === 'string' ? fields.password : '';

	// Both compares always run: returning early on the username would time it.
	const okUsername = secretEquals(username, admin.username);
	const okPassword = secretEquals(password, admin.password);

	return okUsername && okPassword ? { id: 'admin', name: admin.username } : null;
}

// timingSafeEqual requires matching buffer lengths, so length still leaks.
function secretEquals(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}
