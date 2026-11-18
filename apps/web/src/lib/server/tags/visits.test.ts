import { createVisitPeriod, visitDays, zeroVisitTotals, type VisitDetails } from '@goto/analytics';
import type { LinkVisitDetails } from '@goto/db/visit-reports';
import { expect, test } from 'vitest';
import { combineTagVisits } from './visits.js';

test('combines outcomes and overlapping named counts without changing member details', () => {
	const period = createVisitPeriod(3, Date.UTC(2026, 5, 15, 12));
	const days = visitDays(period);
	const firstDay = '2026-03-15';
	const lastDay = '2026-06-15';
	const first: VisitDetails = {
		version: 5,
		lastActivityAt: '2026-06-15T09:00:00.000Z',
		scope: { kind: 'link', domain: 'one.example.test', path: '/docs' },
		period,
		daily: days.map((day) => {
			let counts = zeroVisitTotals();
			if (day.start.startsWith(firstDay)) counts = { validVisits: 2, invalidVisits: 1 };
			if (day.start.startsWith(lastDay)) counts = { validVisits: 1, invalidVisits: 0 };
			return { ...day, ...counts };
		}),
		browsers: [
			{ day: firstDay, name: 'Firefox', validVisits: 2, invalidVisits: 1 },
			{ day: lastDay, name: 'Chrome', validVisits: 1, invalidVisits: 0 }
		],
		operatingSystems: [
			{ day: firstDay, name: 'Linux', validVisits: 2, invalidVisits: 1 },
			{ day: lastDay, name: 'Other', validVisits: 1, invalidVisits: 0 }
		],
		acceptedLanguages: [
			{ day: firstDay, name: 'en', validVisits: 2, invalidVisits: 1 },
			{ day: firstDay, name: 'fr', validVisits: 2, invalidVisits: 1 },
			{ day: lastDay, name: 'Other', validVisits: 1, invalidVisits: 0 }
		]
	};
	const second: VisitDetails = {
		version: 5,
		lastActivityAt: '2026-06-15T10:00:00.000Z',
		scope: { kind: 'link', domain: 'two.example.test', path: '/docs' },
		period,
		daily: days
			.map((day) => {
				let counts = zeroVisitTotals();
				if (day.start.startsWith(firstDay)) counts = { validVisits: 4, invalidVisits: 2 };
				if (day.start.startsWith(lastDay)) counts = { validVisits: 0, invalidVisits: 3 };
				return { ...day, ...counts };
			})
			.reverse(),
		browsers: [
			{ day: lastDay, name: 'Safari', validVisits: 0, invalidVisits: 3 },
			{ day: firstDay, name: 'Chrome', validVisits: 3, invalidVisits: 0 },
			{ day: firstDay, name: 'Firefox', validVisits: 1, invalidVisits: 2 }
		],
		operatingSystems: [
			{ day: lastDay, name: 'Other', validVisits: 0, invalidVisits: 3 },
			{ day: firstDay, name: 'Linux', validVisits: 4, invalidVisits: 2 }
		],
		acceptedLanguages: [
			{ day: lastDay, name: 'Other', validVisits: 0, invalidVisits: 3 },
			{ day: firstDay, name: 'en', validVisits: 4, invalidVisits: 2 },
			{ day: firstDay, name: 'fr', validVisits: 4, invalidVisits: 2 }
		]
	};
	const report: LinkVisitDetails = {
		period,
		links: [
			{ domain: 'one.example.test', path: '/docs', details: first },
			{ domain: 'two.example.test', path: '/docs', details: second }
		]
	};
	const original = structuredClone(report);

	expect(combineTagVisits(report)).toEqual({
		period,
		lastActivityAt: second.lastActivityAt,
		daily: days.map((day) => {
			let counts = zeroVisitTotals();
			if (day.start.startsWith(firstDay)) counts = { validVisits: 6, invalidVisits: 3 };
			if (day.start.startsWith(lastDay)) counts = { validVisits: 1, invalidVisits: 3 };
			return { ...day, ...counts };
		}),
		browsers: [
			{ day: firstDay, name: 'Chrome', validVisits: 3, invalidVisits: 0 },
			{ day: firstDay, name: 'Firefox', validVisits: 3, invalidVisits: 3 },
			{ day: lastDay, name: 'Chrome', validVisits: 1, invalidVisits: 0 },
			{ day: lastDay, name: 'Safari', validVisits: 0, invalidVisits: 3 }
		],
		operatingSystems: [
			{ day: firstDay, name: 'Linux', validVisits: 6, invalidVisits: 3 },
			{ day: lastDay, name: 'Other', validVisits: 1, invalidVisits: 3 }
		],
		acceptedLanguages: [
			{ day: firstDay, name: 'en', validVisits: 6, invalidVisits: 3 },
			{ day: firstDay, name: 'fr', validVisits: 6, invalidVisits: 3 },
			{ day: lastDay, name: 'Other', validVisits: 1, invalidVisits: 3 }
		]
	});
	expect(report).toEqual(original);
});
