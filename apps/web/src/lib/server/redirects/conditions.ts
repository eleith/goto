import type { RedirectRule } from '@goto/config';
import { parseAcceptedLanguages } from '@goto/config/languages';
import { classifyOperatingSystem } from '@goto/db/user-agent';

export interface RedirectRequestHeaders {
	acceptLanguage?: string | undefined;
	userAgent?: string | undefined;
}

export interface ConditionalDestination {
	url: string;
	vary?: string;
}

interface ParsedRedirectHeaders {
	languages: ReturnType<typeof parseAcceptedLanguages> | undefined;
	operatingSystem: string | undefined;
	vary: string;
}

export function selectConditionalDestination(
	defaultUrl: string,
	rules: readonly RedirectRule[],
	requestHeaders: RedirectRequestHeaders = {}
): ConditionalDestination {
	if (rules.length === 0) return { url: defaultUrl };

	const parsedHeaders = parseRequiredHeaders(rules, requestHeaders);
	const matchingRule = rules.find((rule) => matchesRule(rule, parsedHeaders));
	if (matchingRule === undefined) return { url: defaultUrl, vary: parsedHeaders.vary };
	return { url: matchingRule.to, vary: parsedHeaders.vary };
}

function parseRequiredHeaders(
	rules: readonly RedirectRule[],
	requestHeaders: RedirectRequestHeaders
): ParsedRedirectHeaders {
	const varyingHeaders: string[] = [];
	let languages: ParsedRedirectHeaders['languages'];
	if (rules.some((rule) => rule.if.language !== undefined)) {
		languages = parseAcceptedLanguages(requestHeaders.acceptLanguage);
		varyingHeaders.push('Accept-Language');
	}
	let operatingSystem: string | undefined;
	if (rules.some((rule) => rule.if.os !== undefined)) {
		operatingSystem = classifyOperatingSystem(requestHeaders.userAgent).toLowerCase();
		varyingHeaders.push('User-Agent');
	}
	return { languages, operatingSystem, vary: varyingHeaders.join(', ') };
}

function matchesRule(rule: RedirectRule, parsedHeaders: ParsedRedirectHeaders): boolean {
	const { language, os } = rule.if;
	if (language !== undefined && !acceptsLanguage(language, parsedHeaders.languages)) return false;
	return os === undefined || os === parsedHeaders.operatingSystem;
}

function acceptsLanguage(language: string, accepted: ParsedRedirectHeaders['languages']): boolean {
	if (accepted === undefined) return false;
	if (language.includes('-')) return accepted.tags.includes(language);
	return accepted.primaryLanguages.includes(language);
}
