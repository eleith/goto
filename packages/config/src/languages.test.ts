import { describe, expect, it } from 'vitest';
import { parseAcceptedLanguages } from './languages.js';

describe('accepted languages', () => {
	it.each([
		{
			header: 'fr-CA,en;q=0.5',
			tags: ['fr-ca'],
			primaryLanguages: ['fr']
		},
		{
			header: 'fr-CA,en;q=0.9',
			tags: ['fr-ca', 'en'],
			primaryLanguages: ['fr', 'en']
		},
		{ header: 'en;q=0.8', tags: [], primaryLanguages: [] }
	])('uses the absolute quality threshold for $header', ({ header, tags, primaryLanguages }) => {
		expect(parseAcceptedLanguages(header)).toEqual({ tags, primaryLanguages });
	});

	it('normalizes full tags and deduplicates primary memberships without ranking quality', () => {
		expect(parseAcceptedLanguages(' \tFR-ca ; Q=0.900,fr,FR-CA,en;q=1,zh-Hant-TW,qaa')).toEqual({
			tags: ['fr-ca', 'fr', 'en', 'zh-hant-tw', 'qaa'],
			primaryLanguages: ['fr', 'en', 'zh', 'qaa']
		});
	});

	it('ignores malformed entries and wildcards without discarding another eligible entry', () => {
		const header = '*,en;q=.9,de;q=1.001,it;q=1;q=1,pt_BR,fr-CA;q=0.9';
		expect(parseAcceptedLanguages(header)).toEqual({ tags: ['fr-ca'], primaryLanguages: ['fr'] });
	});

	it('does not trim non-HTTP whitespace into a valid tag or quality', () => {
		expect(parseAcceptedLanguages('fr\n,en;q=0.9\n,\rde,es')).toEqual({
			tags: ['es'],
			primaryLanguages: ['es']
		});
	});

	it('allows an eligible duplicate even when another entry rejects that language', () => {
		expect(parseAcceptedLanguages('en;q=0,en;q=0.9')).toEqual({
			tags: ['en'],
			primaryLanguages: ['en']
		});
	});

	it('leaves missing or ineligible headers empty for the caller to handle', () => {
		expect(parseAcceptedLanguages(null)).toEqual({ tags: [], primaryLanguages: [] });
		expect(parseAcceptedLanguages(undefined)).toEqual({ tags: [], primaryLanguages: [] });
		expect(parseAcceptedLanguages('')).toEqual({ tags: [], primaryLanguages: [] });
		expect(parseAcceptedLanguages('*;q=1,en;q=0.899')).toEqual({ tags: [], primaryLanguages: [] });
	});
});
