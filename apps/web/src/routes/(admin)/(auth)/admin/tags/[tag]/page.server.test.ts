import { loadConfig } from '@goto/config';
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

const tag = 'Work/100%é';
const firstDomain = 'go.example.test';
const secondDomain = 'tiny.example.test';
const visitsByDomain: Record<string, Record<string, number>> = {
	[firstDomain]: { '/docs': 100, '/guide': 3, '/a%2Fb': 4 },
	[secondDomain]: { '/docs': 6, '/other': 200 }
};

function request({
	selectedTag = tag,
	retentionMonths = 3,
	firstLinkTags = [tag, tag, 'work']
}: { selectedTag?: string; retentionMonths?: 0 | 3; firstLinkTags?: string[] } = {}) {
	const prepared = loadConfig(
		{
			auth: { credentials: { username: 'test', password: 'tag-page-test-password' } },
			analytics: { retention_months: retentionMonths },
			domains: {
				[firstDomain]: {
					links: {
						'/docs': { url: 'https://example.test/docs', tags: firstLinkTags, max_visits: 100 },
						'/guide': { url: 'https://example.test/guide', tags: [tag] },
						'/a%2Fb': { url: 'https://example.test/percent', tags: ['%2F'], enabled: false }
					}
				},
				[secondDomain]: {
					links: {
						'/docs': { url: 'https://example.test/other', tags: [tag], max_visits: 100 },
						'/other': { url: 'https://example.test/unrelated' }
					}
				}
			}
		},
		{ env: {} }
	);
	const snapshot = prepareSnapshot(prepared);
	const linkVisitCount = vi.fn(
		(domain: string, path: string) => visitsByDomain[domain]?.[path] ?? 0
	);
	const application: Application = { currentSnapshot: () => snapshot, linkVisitCount };
	return {
		locals: { snapshot, application },
		params: { tag: selectedTag }
	} as Parameters<typeof load>[0];
}

test('uses each current link lifetime count once for the summary, inventory, and status', async () => {
	const lastActivityAt = '2026-06-15T10:00:00.000Z';
	vi.mocked(readLastActivity).mockResolvedValue({ available: true, lastActivityAt });
	const event = request();
	const data = await load(event);

	expect(data).toEqual({
		tag,
		analyticsEnabled: true,
		lastActivityAt: Date.parse(lastActivityAt),
		domainCount: 2,
		totalVisits: 109,
		links: [
			{
				domain: firstDomain,
				path: '/docs',
				state: 'exhausted',
				visits: 100,
				href: '/admin/domains/go.example.test/links/docs'
			},
			{
				domain: firstDomain,
				path: '/guide',
				state: 'active',
				visits: 3,
				href: '/admin/domains/go.example.test/links/guide'
			},
			{
				domain: secondDomain,
				path: '/docs',
				state: 'active',
				visits: 6,
				href: '/admin/domains/tiny.example.test/links/docs'
			}
		]
	});
	expect(vi.mocked(event.locals.application.linkVisitCount).mock.calls).toEqual([
		[firstDomain, '/docs'],
		[firstDomain, '/guide'],
		[secondDomain, '/docs']
	]);
	expect(readLastActivity).toHaveBeenCalledExactlyOnceWith(expect.any(Object), [
		{ kind: 'link', domain: firstDomain, path: '/docs' },
		{ kind: 'link', domain: firstDomain, path: '/guide' },
		{ kind: 'link', domain: secondDomain, path: '/docs' }
	]);
});

test('keeps current-member totals when retained activity is unavailable', async () => {
	const data = await load(request({ firstLinkTags: ['Different'] }));
	expect(data.totalVisits).toBe(9);
	expect(data.lastActivityAt).toBeNull();
	expect(readLastActivity).toHaveBeenCalledExactlyOnceWith(expect.any(Object), [
		{ kind: 'link', domain: firstDomain, path: '/guide' },
		{ kind: 'link', domain: secondDomain, path: '/docs' }
	]);
});

test('keeps literal percent identities and shows lifetime visits at zero retention', async () => {
	const data = await load(request({ selectedTag: '%2F', retentionMonths: 0 }));
	expect(readLastActivity).not.toHaveBeenCalled();
	expect(data).toEqual({
		tag: '%2F',
		analyticsEnabled: false,
		lastActivityAt: null,
		domainCount: 1,
		totalVisits: 4,
		links: [
			{
				domain: firstDomain,
				path: '/a%2Fb',
				state: 'disabled',
				visits: 4,
				href: '/admin/domains/go.example.test/links/a%252Fb'
			}
		]
	});
});

test('rejects unknown literal labels before reading visits or activity', async () => {
	const event = request({ selectedTag: 'work/100%é' });
	await expect(load(event)).rejects.toMatchObject({ status: 404 });
	expect(readLastActivity).not.toHaveBeenCalled();
	expect(event.locals.application.linkVisitCount).not.toHaveBeenCalled();
});
