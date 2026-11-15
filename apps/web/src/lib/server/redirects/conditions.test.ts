import type { RedirectRule } from '@goto/config';
import { expect, test, vi } from 'vitest';
import { selectConditionalDestination } from './conditions.js';

const defaultUrl = 'https://example.test/default';
const english = 'https://example.test/english';
const french = 'https://example.test/french';
const ios = 'https://example.test/ios';
const frenchIos = 'https://example.test/french-ios';

test('uses YAML order among eligible languages, not header order or relative quality', () => {
	const rules: RedirectRule[] = [
		{ if: { language: 'en' }, to: english },
		{ if: { language: 'fr' }, to: french }
	];

	expect(
		selectConditionalDestination(defaultUrl, rules, { acceptLanguage: 'fr,en;q=0.9' })
	).toEqual({ url: english, vary: 'Accept-Language' });
	expect(selectConditionalDestination(defaultUrl, rules, { acceptLanguage: 'en;q=0.8' })).toEqual({
		url: defaultUrl,
		vary: 'Accept-Language'
	});
});

test('matches bare language families but requires full-tag criteria to match exactly', () => {
	const regional = 'https://example.test/french-canadian';
	const rules: RedirectRule[] = [
		{ if: { language: 'fr-ca' }, to: regional },
		{ if: { language: 'fr' }, to: french }
	];

	expect(selectConditionalDestination(defaultUrl, rules, { acceptLanguage: 'FR-CA' }).url).toBe(
		regional
	);
	expect(
		selectConditionalDestination(defaultUrl, rules, { acceptLanguage: 'fr-CA-x-demo' }).url
	).toBe(french);
	expect(selectConditionalDestination(defaultUrl, rules, { acceptLanguage: 'fr' }).url).toBe(
		french
	);
});

test('ANDs specified conditions without letting unknown OS defeat language-only rules', () => {
	const rules: RedirectRule[] = [
		{ if: { language: 'fr', os: 'ios' }, to: frenchIos },
		{ if: { os: 'ios' }, to: ios },
		{ if: { language: 'fr' }, to: french }
	];

	expect(
		selectConditionalDestination(defaultUrl, rules, { acceptLanguage: 'fr', userAgent: 'iPhone' })
			.url
	).toBe(frenchIos);
	expect(
		selectConditionalDestination(defaultUrl, rules, { acceptLanguage: 'en', userAgent: 'iPhone' })
			.url
	).toBe(ios);
	expect(
		selectConditionalDestination(defaultUrl, rules, {
			acceptLanguage: 'fr',
			userAgent: 'Unknown agent'
		}).url
	).toBe(french);
});

test('reads only required request headers once when walking multiple rules', () => {
	const language = vi.fn(() => 'en');
	const userAgent = vi.fn(() => 'iPhone');
	const requestHeaders = {
		get acceptLanguage() {
			return language();
		},
		get userAgent() {
			return userAgent();
		}
	};

	const languageRules: RedirectRule[] = [
		{ if: { language: 'fr' }, to: french },
		{ if: { language: 'en' }, to: english }
	];
	expect(selectConditionalDestination(defaultUrl, languageRules, requestHeaders).url).toBe(english);
	expect(language).toHaveBeenCalledTimes(1);
	expect(userAgent).not.toHaveBeenCalled();

	const osRules: RedirectRule[] = [
		{ if: { os: 'linux' }, to: 'https://example.test/linux' },
		{ if: { os: 'ios' }, to: ios }
	];
	expect(selectConditionalDestination(defaultUrl, osRules, requestHeaders)).toEqual({
		url: ios,
		vary: 'User-Agent'
	});
	expect(userAgent).toHaveBeenCalledTimes(1);
	expect(language).toHaveBeenCalledTimes(1);
});
