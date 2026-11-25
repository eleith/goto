import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createVisitPeriod } from '../packages/analytics/src/period.ts';
import { loadConfig } from '../packages/config/src/index.ts';
import { openDb, insertVisit, runMigrations } from '../packages/db/src/index.ts';
import { classifyUserAgent } from '../packages/db/src/classify-user-agent.ts';
import { generateVisits } from './seed-visits-data.js';

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

const existingVisit = {
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

async function createDatabaseWithExistingVisit(databasePath) {
	const db = await openDb(databasePath);
	try {
		await runMigrations(db);
		const id = await insertVisit(db, existingVisit);
		return { id, processed: 0, ...existingVisit };
	} finally {
		await db.destroy();
	}
}

async function readVisits(databasePath) {
	const db = await openDb(databasePath, { readOnly: true });
	try {
		return (await db.selectFrom('visits').selectAll().execute()).map((row) => ({ ...row }));
	} finally {
		await db.destroy();
	}
}

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

test('fixed inputs produce repeatable retained traffic with request-time outcomes and consistent profiles', () => {
	const source = structuredClone(fixture);
	source.fallback = { url: 'https://example.org/missing' };
	source.domains['one.example.test'].root = {
		url: 'https://example.org/',
		status_code: 307,
		forward_query: true
	};
	source.domains['one.example.test'].links = {
		'/docs': {
			url: 'https://example.org/docs',
			valid_from: '2026-03-31T00:00:00Z',
			valid_until: '2026-04-30T00:00:00Z'
		},
		'/disabled': { url: 'https://example.org/off', enabled: false },
		'/future': { url: 'https://example.org/future', valid_from: '2027-01-01T00:00:00Z' }
	};
	const { domains } = loadConfig(source, { env: {} });
	const asOf = Date.parse('2026-05-31T12:00:00Z');
	const period = createVisitPeriod(3, asOf);
	const since = Date.parse(period.from);
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
		if (visit.path === '/') {
			assert.equal(visit.outcome, 'valid');
		}
		if (visit.path === '/future') assert.equal(visit.outcome, 'invalid');
	}
	for (const domain of Object.keys(domains)) {
		assert(visits.some((visit) => visit.domain === domain && visit.path === '/'));
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

test('reports the field when the worker database path conflicts with the default visits path', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-seed-shared-database-'));
	try {
		const { configPath } = await deployment(directory);
		await writeFile(
			configPath,
			JSON.stringify({ ...fixture, database: { worker_path: './data/goto.sqlite' } })
		);
		const result = run('--config', configPath);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /\/database\/worker_path: Must not resolve to the same path/);
		assert.equal(result.stdout, '');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('preview leaves existing visits untouched; apply appends visits for every domain', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-seed-apply-'));
	try {
		const { configPath, databasePath } = await deployment(directory);
		const existing = await createDatabaseWithExistingVisit(databasePath);
		const args = ['--config', configPath, '--visits-per-domain', '100', '--seed', '17'];
		const preview = run(...args);
		assert.equal(preview.status, 0, preview.stderr);
		assert.match(preview.stdout, /Dry run/);
		assert.deepEqual(await readVisits(databasePath), [existing]);

		const result = run(...args, '--apply');
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Appended 300 synthetic visits/);
		const rows = await readVisits(databasePath);
		assert.equal(rows.length, 301);
		assert.deepEqual(
			rows.find(({ id }) => id === existing.id),
			existing
		);
		const synthetic = rows.filter((row) => row.user_agent?.endsWith(' GotoSeed/17'));
		for (const domain of Object.keys(fixture.domains)) {
			assert.equal(synthetic.filter((row) => row.domain === domain).length, 100);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('a failed second batch rolls back its partial writes and preserves committed visits', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'goto-seed-failure-'));
	try {
		const { configPath, databasePath } = await deployment(directory);
		const existing = await createDatabaseWithExistingVisit(databasePath);
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
		const rows = await readVisits(databasePath);
		assert.equal(rows.filter((row) => row.user_agent?.endsWith(' GotoSeed/17')).length, 250);
		assert.equal(rows.length, 251);
		assert.deepEqual(
			rows.find(({ id }) => id === existing.id),
			existing
		);
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
