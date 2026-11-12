import type { Handle } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { betterAuth, type BetterAuthOptions } from 'better-auth/minimal';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { GotoConfiguration } from '@goto/config';
import type { Immutable } from '../snapshot.js';
import { buildAuthOptions } from './providers.js';
import { resolveAuthSecret } from './secret.js';

const WEEK_SECONDS = 7 * 24 * 60 * 60;

export interface GotoSession {
	user: { name: string; email?: string; image?: string | null };
	expires: string;
}

export function createAuthentication(cfg: Immutable<GotoConfiguration>) {
	const origin = cfg.url.app;
	const secret = resolveAuthSecret(cfg.auth.secret);
	return betterAuth<BetterAuthOptions & { baseURL: string }>({
		secret,
		secrets: [{ version: 1, value: secret }],
		baseURL: origin,
		basePath: '/auth',
		trustedOrigins: [origin],
		telemetry: { enabled: false },
		session: {
			expiresIn: WEEK_SECONDS,
			disableSessionRefresh: true,
			cookieCache: { refreshCache: false }
		},
		account: {
			storeAccountCookie: false,
			accountLinking: { enabled: false }
		},
		advanced: {
			cookiePrefix: 'goto',
			disableOriginCheck: false,
			ipAddress: { ipAddressHeaders: ['x-real-ip'] }
		},
		...buildAuthOptions(cfg),
		logger: {
			log: (level) => {
				if (level === 'error') console.error('Authentication event (better_auth).');
				else if (level === 'warn') console.warn('Authentication event (better_auth).');
				else console.info('Authentication event (better_auth).');
			}
		}
	});
}

export type Authentication = ReturnType<typeof createAuthentication>;

export const authHandle: Handle = async ({ event, resolve }) => {
	event.locals.auth = async () => null;
	if (building) return resolve(event);

	const adminRoute = event.route.id?.startsWith('/(admin)');
	const authPath = event.url.pathname === '/auth' || event.url.pathname.startsWith('/auth/');
	if (
		event.url.origin !== event.locals.snapshot?.configuration.url.app ||
		(!adminRoute && !authPath)
	) {
		return resolve(event);
	}

	const auth = event.locals.application?.authentication;
	if (!auth) {
		return new Response('Unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
	}

	const readSession = async (): Promise<GotoSession | null> => {
		const data = await auth.api.getSession({ headers: event.request.headers });
		if (!data) return null;
		return {
			user: {
				name: data.user.name,
				email: data.user.email,
				...(data.user.image === undefined ? {} : { image: data.user.image })
			},
			expires: data.session.expiresAt.toISOString()
		};
	};

	let session: Promise<GotoSession | null> | undefined;
	event.locals.auth = () => (session ??= readSession());

	return svelteKitHandler({ event, resolve, auth, building });
};
