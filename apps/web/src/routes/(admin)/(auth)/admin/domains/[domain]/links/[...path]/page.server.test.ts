import { loadConfig, type DomainConfiguration, type LinkConfiguration } from '@goto/config';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Application } from '#lib/server/application.js';
import { prepareSnapshot } from '#lib/server/snapshot.js';
import { readLastActivity } from '#lib/server/visits/reports.js';
import { load } from './+page.server.js';

vi.mock('#lib/server/visits/reports.js', () => ({ readLastActivity: vi.fn() }));
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(readLastActivity).mockResolvedValue({ available: false, lastActivityAt: null });
});

const domain = 'go.example.test';
const linkMetadata = {
	response: { url: 'https://example.test/docs', status_code: 308, forward_query: true },
	redirectRules: [
		{ language: 'fr-ca', os: 'ios', to: 'https://example.test/fr-ios' },
		{ language: null, os: 'linux', to: 'https://example.test/linux' },
		{ language: 'en', os: null, to: 'https://example.test/en' }
	],
	caseInsensitive: false,
	ignoreTrailingSlash: false,
	forwardPath: true,
	maxVisits: null,
	state: 'active',
	validFrom: '2000-01-01T00:00:00Z',
	validUntil: '2100-01-01T00:00:00Z',
	tags: ['guides', 'reference']
};

function request(
	path = '/docs',
	options: { host?: string; retentionMonths?: number; link?: Partial<LinkConfiguration> } = {}
) {
	const domainConfiguration: Partial<DomainConfiguration> = {
		link_defaults: { forward_query: true, ignore_trailing_slash: false },
		links: {
			'/docs': {
				url: 'https://example.test/docs',
				redirect: [
					{ if: { language: 'FR-ca', os: 'ios' }, to: 'https://example.test/fr-ios' },
					{ if: { os: 'linux' }, to: 'https://example.test/linux' },
					{ if: { language: 'en' }, to: 'https://example.test/en' }
				],
				status_code: 308,
				forward_path: true,
				enabled: true,
				valid_from: '2000-01-01T00:00:00Z',
				valid_until: '2100-01-01T00:00:00Z',
				tags: ['guides', 'reference'],
				...options.link
			},
			'/a/b': { url: 'https://example.test/nested', enabled: true, tags: [] },
			'/a%2Fb': {
				url: 'https://example.test/percent',
				redirect: [{ if: { language: 'fr' }, to: 'https://example.test/percent-fr' }],
				enabled: false,
				tags: []
			}
		}
	};
	const prepared = loadConfig(
		{
			auth: { credentials: { username: 'test', password: 'link-test-password' } },
			analytics: { retention_months: options.retentionMonths ?? 3 },
			link_defaults: { status_code: 301, case_insensitive: false },
			domains: { [domain]: domainConfiguration }
		},
		{ env: {} }
	);
	const linkVisitCount = vi.fn((host: string, linkPath: string): number => {
		if (host !== domain) throw new Error('Unexpected domain');
		const visitCounts: Record<string, number> = { '/docs': 102, '/a/b': 3, '/a%2Fb': 8 };
		return visitCounts[linkPath] ?? 0;
	});
	const snapshot = prepareSnapshot(prepared);
	const application: Application = { currentSnapshot: () => snapshot, linkVisitCount };
	return {
		locals: { snapshot, application },
		params: { domain: options.host ?? domain, path: path.slice(1) }
	} as Parameters<typeof load>[0];
}

test('projects only link settings, live lifetime visits, and scoped last activity', async () => {
	const lastActivityAt = '2026-06-15T10:00:00.000Z';
	vi.mocked(readLastActivity).mockResolvedValue({ available: true, lastActivityAt });
	const event = request();
	const data = await load(event);
	expect(event.locals.application.linkVisitCount).toHaveBeenCalledExactlyOnceWith(domain, '/docs');
	expect(readLastActivity).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
		kind: 'link',
		domain,
		path: '/docs'
	});
	expect(data).toEqual({
		domain,
		path: '/docs',
		lifetimeVisits: 102,
		...linkMetadata,
		analyticsEnabled: true,
		lastActivityAt: Date.parse(lastActivityAt)
	});
});

test('keeps decoded nested and literal-percent identities distinct', async () => {
	const nestedEvent = request('/a/b');
	const percentEvent = request('/a%2Fb');
	const nested = await load(nestedEvent);
	const percent = await load(percentEvent);
	expect(nestedEvent.locals.application.linkVisitCount).toHaveBeenCalledExactlyOnceWith(
		domain,
		'/a/b'
	);
	expect(percentEvent.locals.application.linkVisitCount).toHaveBeenCalledExactlyOnceWith(
		domain,
		'/a%2Fb'
	);
	expect(nested.path).toBe('/a/b');
	expect(nested.lifetimeVisits).toBe(3);
	expect(nested).toMatchObject({
		response: { url: 'https://example.test/nested', status_code: 301, forward_query: true },
		redirectRules: [],
		caseInsensitive: false,
		ignoreTrailingSlash: false,
		forwardPath: false,
		maxVisits: null,
		state: 'active',
		validFrom: null,
		validUntil: null,
		tags: []
	});
	expect(percent.path).toBe('/a%2Fb');
	expect(percent.lifetimeVisits).toBe(8);
	expect(percent.maxVisits).toBeNull();
	expect(percent.state).toBe('disabled');
	expect(percent.redirectRules).toEqual([
		{ language: 'fr', os: null, to: 'https://example.test/percent-fr' }
	]);
	expect(readLastActivity).toHaveBeenNthCalledWith(1, expect.any(Object), {
		kind: 'link',
		domain,
		path: '/a/b'
	});
	expect(readLastActivity).toHaveBeenNthCalledWith(2, expect.any(Object), {
		kind: 'link',
		domain,
		path: '/a%2Fb'
	});
});

test('rejects unknown scopes and keeps lifetime visits when activity is unavailable', async () => {
	await expect(load(request('/docs', { host: 'unknown.test' }))).rejects.toMatchObject({
		status: 404
	});
	const missing = request('/not-configured');
	await expect(load(missing)).rejects.toMatchObject({ status: 404 });
	await expect(load(request('/'))).rejects.toMatchObject({ status: 404 });
	expect(missing.locals.application.linkVisitCount).not.toHaveBeenCalled();
	expect(readLastActivity).not.toHaveBeenCalled();

	expect(await load(request())).toMatchObject({
		...linkMetadata,
		lifetimeVisits: 102,
		analyticsEnabled: true,
		lastActivityAt: null
	});
});

test.each([
	{ maxVisits: 102, state: 'exhausted' },
	{ maxVisits: 103, state: 'active' }
])(
	'projects configured max $maxVisits and $state from one lifetime lookup',
	async ({ maxVisits, state }) => {
		const event = request('/docs', { link: { max_visits: maxVisits } });
		const data = await load(event);
		expect(data).toMatchObject({ maxVisits, state, lifetimeVisits: 102 });
		expect(event.locals.application.linkVisitCount).toHaveBeenCalledExactlyOnceWith(
			domain,
			'/docs'
		);
	}
);

test('disabled analytics preserves a configured limit and exhaustion without reading activity', async () => {
	const event = request('/docs', { retentionMonths: 0, link: { max_visits: 102 } });
	const data = await load(event);
	expect(event.locals.application.linkVisitCount).toHaveBeenCalledExactlyOnceWith(domain, '/docs');
	expect(readLastActivity).not.toHaveBeenCalled();
	expect(data).toMatchObject({
		...linkMetadata,
		lifetimeVisits: 102,
		analyticsEnabled: false,
		lastActivityAt: null,
		maxVisits: 102,
		state: 'exhausted'
	});
});
