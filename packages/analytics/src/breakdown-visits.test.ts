import { expect, test } from 'vitest';
import { visitWindow, type VisitTimeframe } from './daily.js';
import {
	countAcceptedLanguageVisitsByTimeframe,
	countBrowserOsVisitsByTimeframe
} from './index.js';
import { createVisitPeriod } from './period.js';
import type { VisitDetails } from './reports.js';

test('counts only valid visits in each UTC timeframe, combining browser/OS counts and sorting ties by name', () => {
	const period = createVisitPeriod(3, Date.parse('2026-06-15T12:00:00.000Z'));
	const details: Pick<VisitDetails, 'browsers' | 'operatingSystems'> = {
		browsers: [
			{ day: '2026-03-15', name: 'Other', validVisits: 100, invalidVisits: 0 },
			{ day: '2026-06-09', name: 'Firefox', validVisits: 2, invalidVisits: 40 },
			{ day: '2026-06-09', name: 'Chrome', validVisits: 3, invalidVisits: 0 },
			{ day: '2026-06-15', name: 'Firefox', validVisits: 2, invalidVisits: 0 },
			{ day: '2026-06-15', name: 'Chrome', validVisits: 1, invalidVisits: 0 },
			{ day: '2026-06-15', name: 'Other', validVisits: 5, invalidVisits: 0 },
			{ day: '2026-06-15', name: 'Safari', validVisits: 0, invalidVisits: 90 }
		],
		operatingSystems: [
			{ day: '2026-03-15', name: 'Windows', validVisits: 100, invalidVisits: 0 },
			{ day: '2026-06-09', name: 'Linux', validVisits: 5, invalidVisits: 40 },
			{ day: '2026-06-15', name: 'Linux', validVisits: 8, invalidVisits: 0 },
			{ day: '2026-06-15', name: 'Other', validVisits: 0, invalidVisits: 90 }
		]
	};
	const original = structuredClone(details);
	const timeframes: VisitTimeframe[] = ['7d', 'all'];
	const windows = timeframes.map((timeframe) => ({
		timeframe,
		window: visitWindow(period, timeframe)
	}));

	expect(countBrowserOsVisitsByTimeframe(details, windows)).toEqual({
		'7d': {
			browsers: [
				{ name: 'Other', visits: 5 },
				{ name: 'Chrome', visits: 4 },
				{ name: 'Firefox', visits: 4 }
			],
			operatingSystems: [{ name: 'Linux', visits: 13 }]
		},
		all: {
			browsers: [
				{ name: 'Other', visits: 105 },
				{ name: 'Chrome', visits: 4 },
				{ name: 'Firefox', visits: 4 }
			],
			operatingSystems: [
				{ name: 'Windows', visits: 100 },
				{ name: 'Linux', visits: 13 }
			]
		}
	});
	expect(details).toEqual(original);
});

test('counts overlapping language memberships independently using valid visits in the selected window', () => {
	const period = createVisitPeriod(3, Date.parse('2026-06-15T12:00:00.000Z'));
	const details: Pick<VisitDetails, 'acceptedLanguages'> = {
		acceptedLanguages: [
			{ day: '2026-03-15', name: 'fr', validVisits: 100, invalidVisits: 0 },
			{ day: '2026-06-08', name: 'Other', validVisits: 100, invalidVisits: 0 },
			{ day: '2026-06-09', name: 'fr', validVisits: 2, invalidVisits: 40 },
			{ day: '2026-06-09', name: 'en', validVisits: 2, invalidVisits: 40 },
			{ day: '2026-06-15', name: 'fr', validVisits: 3, invalidVisits: 0 },
			{ day: '2026-06-15', name: 'en', validVisits: 3, invalidVisits: 0 },
			{ day: '2026-06-15', name: 'Other', validVisits: 1, invalidVisits: 0 },
			{ day: '2026-06-15', name: 'de', validVisits: 0, invalidVisits: 9 },
			{ day: '2026-06-16', name: 'fr', validVisits: 100, invalidVisits: 0 }
		]
	};
	const original = structuredClone(details);
	const timeframes: VisitTimeframe[] = ['7d', 'all'];
	const windows = timeframes.map((timeframe) => ({
		timeframe,
		window: visitWindow(period, timeframe)
	}));

	expect(countAcceptedLanguageVisitsByTimeframe(details, windows)).toEqual({
		'7d': [
			{ name: 'en', visits: 5 },
			{ name: 'fr', visits: 5 },
			{ name: 'Other', visits: 1 }
		],
		all: [
			{ name: 'fr', visits: 105 },
			{ name: 'Other', visits: 101 },
			{ name: 'en', visits: 5 }
		]
	});
	expect(details).toEqual(original);
});

test('intersects UTC days at partial and exclusive boundaries rather than filtering by midnight alone', () => {
	const rows = [
		{ day: '2024-02-27', name: 'Other', validVisits: 100, invalidVisits: 0 },
		{ day: '2024-02-28', name: 'Other', validVisits: 2, invalidVisits: 0 },
		{ day: '2024-02-29', name: 'Other', validVisits: 3, invalidVisits: 0 },
		{ day: '2024-03-01', name: 'Other', validVisits: 100, invalidVisits: 0 }
	];
	expect(
		countBrowserOsVisitsByTimeframe({ browsers: rows, operatingSystems: rows }, [
			{
				timeframe: 'all',
				window: { from: '2024-02-28T12:00:00.000Z', asOf: '2024-03-01T00:00:00.000Z' }
			}
		])
	).toEqual({
		all: {
			browsers: [{ name: 'Other', visits: 5 }],
			operatingSystems: [{ name: 'Other', visits: 5 }]
		}
	});
});

test('missing reports remain unavailable while empty and invalid-only reports have explicit empty windows', () => {
	const period = createVisitPeriod(3, Date.parse('2026-06-15T12:00:00.000Z'));
	const timeframes: VisitTimeframe[] = ['7d', '30d', 'all'];
	const windows = timeframes.map((timeframe) => ({
		timeframe,
		window: visitWindow(period, timeframe)
	}));
	const empty = {
		'7d': { browsers: [], operatingSystems: [] },
		'30d': { browsers: [], operatingSystems: [] },
		all: { browsers: [], operatingSystems: [] }
	};

	expect(countBrowserOsVisitsByTimeframe(undefined, windows)).toEqual({});
	expect(countBrowserOsVisitsByTimeframe({ browsers: [], operatingSystems: [] }, windows)).toEqual(
		empty
	);
	const rows = [{ day: '2026-06-15', name: 'Other', validVisits: 0, invalidVisits: 5 }];
	expect(
		countBrowserOsVisitsByTimeframe({ browsers: rows, operatingSystems: rows }, windows)
	).toEqual(empty);

	const emptyLanguages = { '7d': [], '30d': [], all: [] };
	expect(countAcceptedLanguageVisitsByTimeframe(undefined, windows)).toEqual({});
	expect(countAcceptedLanguageVisitsByTimeframe({ acceptedLanguages: [] }, windows)).toEqual(
		emptyLanguages
	);
	expect(countAcceptedLanguageVisitsByTimeframe({ acceptedLanguages: rows }, windows)).toEqual(
		emptyLanguages
	);
});
