import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../packages/config/src/index.ts';
import { openDb, insertVisit, runMigrations } from '../packages/db/src/index.ts';
import { classifyUserAgent } from '../packages/db/src/classify-user-agent.ts';
import { generateVisits, seedWindowStart } from './seed-visits-data.js';

const script = fileURLToPath(new URL('./seed-visits.js', import.meta.url));
const loader = fileURLToPath(new URL('../tools/register.mjs', import.meta.url));
const fixture = {
	url: { app: 'https://admin.example.test' },
	auth: { credentials: { username: 'test', password: 'seed-test-only-password' } },
	domains: {
		'one.example.test': { links: { '/docs': { url: 'https://example.org/docs' } } },
		'two.example.test': { links: { '/docs': { url: 'https://example.com/docs' } } },
		'three.example.test': { links: { '/docs': { url: 'https://example.net/docs' } } }
	}
};

function run(...args) {
	return spawnSync(process.execPath, ['--import', loader, script, ...args], {
		encoding: 'utf8',
		timeout: 15_000
	});
}

async function deployment(directory) {
	await mkdir(join(directory, 'config'));
	const configPath = join(directory, 'config/goto.yaml');
	await writeFile(configPath, JSON.stringify(fixture));
	return { configPath, databasePath: join(directory, 'data/goto.sqlite') };
}

test('calendar window clamps month ends and keeps UTC time', () => {
	const since = seedWindowStart(3, Date.parse('2026-05-31T12:34:56.789Z'));
	assert.equal(new Date(since).toISOString(), '2026-02-28T12:34:56.789Z');
	const leap = seedWindowStart(12, Date.parse('2024-02-29T12:00:00Z'));
	assert.equal(new Date(leap).toISOString(), '2023-02-28T12:00:00.000Z');
});

test('fixed inputs produce repeatable retained traffic with request-time outcomes and consistent profiles', () => {
	const source = structuredClone(fixture);
	source.domains['one.example.test'].links = {
		'/': { url: 'https://example.org/' },
		'/docs': {
			url: 'https://example.org/docs',
			valid_from: '2026-03-31T00:00:00Z',
			valid_until: '2026-04-30T00:00:00Z'
		},
		'/disabled': { url: 'https://example.org/off', enabled: false },
		'/future': { url: 'https://example.org/future', valid_from: '2027-01-01T00:00:00Z' }
	};
	const { domains } = validateConfig(source, { env: {} });
	const asOf = Date.parse('2026-05-31T12:00:00Z');
	const since = seedWindowStart(3, asOf);
	const options = { domains, since, asOf, visitsPerDomain: 300, seed: 42 };
	const visits = [...generateVisits(options)];
	assert.deepEqual([...generateVisits(options)], visits);
	assert.equal(visits.length, 900);
	assert(visits.some((visit) => visit.path === '/' && visit.outcome === 'valid'));
	assert(visits.some((visit) => visit.path === '/__seed-missing__' && visit.outcome === 'invalid'));
	assert(visits.some((visit) => visit.path === '/disabled' && visit.outcome === 'invalid'));
	const scheduledVisits = visits.filter(
		(visit) => visit.domain === 'one.example.test' && visit.path === '/docs'
	);
	const startsAt = Date.parse(source.domains['one.example.test'].links['/docs'].valid_from);
	const endsAt = Date.parse(source.domains['one.example.test'].links['/docs'].valid_until);
	assert(scheduledVisits.some((visit) => visit.visited_at < startsAt));
	assert(
		scheduledVisits.some((visit) => visit.visited_at >= startsAt && visit.visited_at < endsAt)
	);
	assert(scheduledVisits.some((visit) => visit.visited_at >= endsAt));
	for (const visit of scheduledVisits) {
		const active = visit.visited_at >= startsAt && visit.visited_at < endsAt;
		assert.equal(visit.outcome, active ? 'valid' : 'invalid');
	}
	for (const visit of visits) {
		assert(visit.visited_at >= since && visit.visited_at < asOf);
		assert.equal(visit.ip, '192.0.2.1');
		assert(visit.user_agent.endsWith(' GotoSeed/42'));
		assert.deepEqual(classifyUserAgent(visit.user_agent), { browser: visit.browser, os: visit.os });
		if (visit.path === '/future') assert.equal(visit.outcome, 'invalid');
	}
});

test('preview opens no SQLite file and applying refuses to create a missing database', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-seed-preview-'));
	try {
		const { configPath, databasePath } = await deployment(directory);
		const preview = run('--config', configPath);
		assert.equal(preview.status, 0, preview.stderr);
		assert.match(preview.stdout, /Dry run/);
		assert.match(preview.stdout, /Total: 30000 visits/);
		await assert.rejects(access(databasePath), { code: 'ENOENT' });
		const apply = run('--config', configPath, '--apply');
		assert.equal(apply.status, 1, apply.stderr);
		assert.match(apply.stderr, /existing visits database/);
		await assert.rejects(access(databasePath), { code: 'ENOENT' });
		await writeFile(configPath, JSON.stringify({ ...fixture, analytics: { retention_months: 0 } }));
		const disabled = run('--config', configPath, '--apply');
		assert.equal(disabled.status, 1);
		assert.match(disabled.stderr, /Analytics collection is disabled/);
		await assert.rejects(access(databasePath), { code: 'ENOENT' });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('explicit apply appends all configured domains in bounded batches without replacing existing visits', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-seed-apply-'));
	try {
		const { configPath, databasePath } = await deployment(directory);
		const existing = {
			domain: 'one.example.test',
			path: '/keep',
			outcome: 'valid',
			visited_at: 1,
			ip: '198.51.100.1',
			user_agent: 'ExistingClient',
			accept_language: null,
			browser: 'Other',
			os: 'Other'
		};
		const writer = await openDb(databasePath);
		let id;
		try {
			await runMigrations(writer);
			id = await insertVisit(writer, existing);
		} finally {
			await writer.destroy();
		}
		const result = run(
			'--config',
			configPath,
			'--visits-per-domain',
			'100',
			'--seed',
			'17',
			'--apply'
		);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Appended 300 synthetic visits/);
		const reader = await openDb(databasePath, { readOnly: true });
		try {
			const rows = await reader.selectFrom('visits').selectAll().execute();
			assert.equal(rows.length, 301);
			const original = rows.find((row) => row.id === id);
			assert.deepEqual({ ...original }, { id, ...existing });
			const synthetic = rows.filter((row) => row.user_agent?.endsWith(' GotoSeed/17'));
			for (const domain of Object.keys(fixture.domains)) {
				assert.equal(synthetic.filter((row) => row.domain === domain).length, 100);
			}
		} finally {
			await reader.destroy();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('a failed second batch rolls back its partial writes and preserves committed visits', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-seed-failure-'));
	try {
		const { configPath, databasePath } = await deployment(directory);
		const existing = {
			domain: 'one.example.test',
			path: '/keep',
			outcome: 'valid',
			visited_at: 1,
			ip: '198.51.100.1',
			user_agent: 'ExistingClient',
			accept_language: null,
			browser: 'Other',
			os: 'Other'
		};
		const writer = await openDb(databasePath);
		let id;
		try {
			await runMigrations(writer);
			id = await insertVisit(writer, existing);
		} finally {
			await writer.destroy();
		}
		const triggerDb = new DatabaseSync(databasePath);
		try {
			triggerDb.exec(`
				CREATE TRIGGER reject_synthetic_visit_275
				BEFORE INSERT ON visits
				WHEN NEW.user_agent LIKE '% GotoSeed/17'
					AND (SELECT COUNT(*) FROM visits WHERE user_agent LIKE '% GotoSeed/17') = 274
				BEGIN
					SELECT RAISE(ABORT, 'synthetic fixture failure');
				END
			`);
		} finally {
			triggerDb.close();
		}
		const result = run(
			'--config',
			configPath,
			'--visits-per-domain',
			'100',
			'--seed',
			'17',
			'--apply'
		);
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, /synthetic fixture failure/);
		assert.match(result.stderr, /Stopped after 250 committed visits/);
		const reader = await openDb(databasePath, { readOnly: true });
		try {
			const rows = await reader.selectFrom('visits').selectAll().execute();
			const synthetic = rows.filter((row) => row.user_agent?.endsWith(' GotoSeed/17'));
			assert.equal(synthetic.length, 250);
			assert.equal(rows.length, 251);
			const original = rows.find((row) => row.id === id);
			assert.deepEqual({ ...original }, { id, ...existing });
		} finally {
			await reader.destroy();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('invalid counts and seeds fail before loading configuration', () => {
	const count = run('--config', '/missing/not-read.yaml', '--visits-per-domain', '0');
	assert.equal(count.status, 1);
	assert.match(count.stderr, /--visits-per-domain/);
	const seed = run('--config', '/missing/not-read.yaml', '--seed', '2147483647');
	assert.equal(seed.status, 1);
	assert.match(seed.stderr, /--seed must be between/);
});
