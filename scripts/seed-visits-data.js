// Synthetic profiles use the existing approximate browser/OS family names.
const profiles = [
	{
		weight: 36,
		browser: 'Chrome',
		os: 'Windows',
		userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/134.0 Safari/537.36'
	},
	{
		weight: 20,
		browser: 'Chrome',
		os: 'Android',
		userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/134.0 Mobile Safari/537.36'
	},
	{
		weight: 14,
		browser: 'Safari',
		os: 'macOS',
		userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/17.0 Safari/605.1.15'
	},
	{
		weight: 10,
		browser: 'Safari',
		os: 'iOS',
		userAgent:
			'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1'
	},
	{
		weight: 10,
		browser: 'Firefox',
		os: 'Linux',
		userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/136.0'
	},
	{
		weight: 5,
		browser: 'Edge',
		os: 'Windows',
		userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/134.0 Safari/537.36 Edg/134.0'
	},
	{
		weight: 2,
		browser: 'Opera',
		os: 'Windows',
		userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/134.0 Safari/537.36 OPR/118.0'
	},
	{
		weight: 2,
		browser: 'Chrome',
		os: 'ChromeOS',
		userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 16000.0.0) Chrome/134.0 Safari/537.36'
	},
	{ weight: 1, browser: 'Other', os: 'Other', userAgent: 'SyntheticClient/1.0' }
];

const languages = [
	'en-US,en;q=0.9',
	'en-GB,en;q=0.9',
	'de-DE,de;q=0.9',
	'fr-FR,fr;q=0.9',
	'ja-JP,ja;q=0.9'
];

export function seedWindowStart(months, asOf) {
	// Retention is UTC calendar months, including month-end clamping.
	const date = new Date(asOf);
	const day = date.getUTCDate();
	date.setUTCDate(1);
	date.setUTCMonth(date.getUTCMonth() - months);
	const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
	date.setUTCDate(Math.min(day, lastDay));
	return date.getTime();
}

export function* generateVisits({ domains, visitsPerDomain, since, asOf, seed }) {
	const random = seededRandom(seed);
	for (const [domain, prepared] of Object.entries(domains)) {
		const paths = requestPaths(prepared.links);
		for (let index = 0; index < visitsPerDomain; index++) {
			const visitedAt = visitTime(random, since, asOf);
			const path = weightedChoice(random, paths).path;
			const profile = weightedChoice(random, profiles);
			const languageIndex = Math.floor(random() * languages.length);
			yield {
				domain,
				path,
				outcome: visitOutcome(prepared, path, visitedAt),
				visited_at: visitedAt,
				ip: '192.0.2.1',
				user_agent: `${profile.userAgent} GotoSeed/${seed}`,
				accept_language: languages[languageIndex],
				browser: profile.browser,
				os: profile.os
			};
		}
	}
}

function requestPaths(links) {
	let missingPath = '/__seed-missing__';
	while (Object.hasOwn(links, missingPath)) missingPath += '-';
	const paths = [
		{ path: '/', weight: 10 },
		{ path: missingPath, weight: 10 }
	];
	// Prefer configured links, with a separate share for base and unmatched requests.
	const configured = Object.keys(links);
	const popularity = configured.reduce((total, _path, index) => total + 1 / (index + 1), 0);
	for (const [index, path] of configured.entries()) {
		const weight = 80 / ((index + 1) * popularity);
		paths.push({ path, weight });
	}
	return paths;
}

function visitOutcome(prepared, path, visitedAt) {
	if (path === '/') return 'valid';
	const link = prepared.links[path];
	if (!link || !link.enabled) return 'invalid';
	if (link.valid_from !== undefined && visitedAt < Date.parse(link.valid_from)) return 'invalid';
	if (link.valid_until !== undefined && visitedAt >= Date.parse(link.valid_until)) return 'invalid';
	return 'valid';
}

function visitTime(random, since, asOf) {
	while (true) {
		const timestamp = since + Math.floor(random() * (asOf - since));
		const date = new Date(timestamp);
		const weekday = date.getUTCDay();
		const hour = date.getUTCHours();
		const weekdayWeight = weekday === 0 || weekday === 6 ? 0.35 : 1;
		const hourWeight = hour >= 8 && hour < 19 ? 1 : 0.3;
		const recencyWeight = 0.4 + 0.6 * ((timestamp - since) / (asOf - since));
		const weight = weekdayWeight * hourWeight * recencyWeight;
		if (random() < weight) return timestamp;
	}
}

function weightedChoice(random, entries) {
	const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
	let remaining = random() * total;
	for (const entry of entries) {
		remaining -= entry.weight;
		if (remaining < 0) return entry;
	}
	return entries.at(-1);
}

function seededRandom(seed) {
	// Park–Miller: repeatable fixture sampling, not cryptographic randomness.
	let state = seed;
	return function random() {
		state = (state * 48271) % 2147483647;
		return (state - 1) / 2147483646;
	};
}
