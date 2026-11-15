// The end assertion rejects a final newline, which JavaScript's $ would allow.
export const languageTagPattern = '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*(?![\\s\\S])';

const languageTag = new RegExp(languageTagPattern);
const languageQuality = /^[\t ]*q=(0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)[\t ]*(?![\s\S])/i;

export function parseAcceptedLanguages(raw: string | null | undefined): {
	tags: string[];
	primaryLanguages: string[];
} {
	const tags = new Set<string>();
	const primaryLanguages = new Set<string>();
	if (raw === null || raw === undefined) return { tags: [], primaryLanguages: [] };

	for (const entry of raw.split(',')) {
		const fields = entry.split(';');
		if (fields.length > 2) continue;
		const tag = fields[0]!.replace(/^[\t ]+|[\t ]+$/g, '');
		if (!languageTag.test(tag)) continue;

		const quality = fields[1];
		if (quality !== undefined) {
			const match = languageQuality.exec(quality);
			if (match === null || Number(match[1]) < 0.9) continue;
		}

		const normalized = normalizeLanguageTag(tag);
		tags.add(normalized);
		primaryLanguages.add(normalized.split('-')[0]!);
	}
	return { tags: [...tags], primaryLanguages: [...primaryLanguages] };
}

export function normalizeLanguageTag(tag: string): string {
	return tag.toLowerCase();
}
