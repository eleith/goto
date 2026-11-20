import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { createVisitPeriod } from '../packages/analytics/src/period.ts';
import { loadConfigFile } from '../packages/config/src/index.ts';
import { openDb, insertVisit } from '../packages/db/src/index.ts';
import { generateVisits } from './seed-visits-data.js';

// Keep write transactions short while the development services share SQLite.
const batchSize = 250;
const help = `Development-only synthetic visit seeder (append-only).

Usage:
  pnpm run seed:visits --config <path> [options]

Options:
  --config <path>               YAML configuration; required
  --visits-per-domain <count>   Visits for each configured domain (default: 10000)
  --seed <integer>              Repeatable sampling seed, 1–2147483646 (default: 42)
  --apply                      Append visits; otherwise preview without opening SQLite
  --help                       Show this help

Uses the configured visits database and retention window. The database must
already exist with the current visits schema; this tool never runs migrations.
Rerunning with --apply appends another dataset. Back up your development data
before applying. Synthetic rows use IP 192.0.2.1 and a GotoSeed/<seed> UA marker.
`;

async function main() {
	const options = readOptions();
	if (options.help) {
		console.log(help);
		return;
	}
	const prepared = await loadConfigFile(options.configPath);
	const plan = seedPlan(prepared, options);
	printPlan(plan, options.apply);
	if (!options.apply) return;
	await appendVisits(plan);
	console.log(
		'Prepared reports update at the next worker refresh; this tool does not trigger one.'
	);
}

function readOptions() {
	const { values } = parseArgs({
		options: {
			config: { type: 'string' },
			'visits-per-domain': { type: 'string', default: '10000' },
			seed: { type: 'string', default: '42' },
			apply: { type: 'boolean', default: false },
			help: { type: 'boolean', default: false }
		}
	});
	if (values.help) return { help: true };
	if (!values.config?.trim()) throw new Error('--config is required; use --help for usage');
	const visitsPerDomain = positiveInteger(values['visits-per-domain'], '--visits-per-domain');
	const seed = positiveInteger(values.seed, '--seed');
	if (seed >= 2147483647) throw new Error('--seed must be between 1 and 2147483646');
	return { configPath: resolve(values.config), visitsPerDomain, seed, apply: values.apply };
}

function positiveInteger(value, name) {
	const number = Number(value);
	if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number)) {
		throw new Error(`${name} must be a positive safe integer`);
	}
	return number;
}

function seedPlan(prepared, options) {
	const { configuration, domains } = prepared;
	const months = configuration.analytics.retention_months;
	if (months === 0) throw new Error('Analytics collection is disabled; no visits will be seeded');
	if (Object.keys(domains).length === 0) throw new Error('No configured domains to seed');
	const total = Object.keys(domains).length * options.visitsPerDomain;
	if (!Number.isSafeInteger(total))
		throw new Error('Total visit count exceeds the safe integer range');
	const databasePath = configuration.database.path;
	if (databasePath === configuration.database.worker_path) {
		throw new Error('Visits and worker database paths must differ');
	}
	const asOf = Date.now();
	const period = createVisitPeriod(months, asOf);
	const since = Date.parse(period.from);
	return {
		databasePath,
		domains,
		since,
		asOf,
		visitsPerDomain: options.visitsPerDomain,
		seed: options.seed,
		total
	};
}

function printPlan(plan, apply) {
	console.log(apply ? 'Append synthetic visits' : 'Dry run — no database opened or changed');
	console.log(`Database: ${plan.databasePath}`);
	console.log(
		`UTC window: ${new Date(plan.since).toISOString()} to ${new Date(plan.asOf).toISOString()} (exclusive)`
	);
	console.log(`Sampling seed: ${plan.seed} (timestamps are relative to this run)`);
	for (const domain of Object.keys(plan.domains))
		console.log(`  ${domain}: ${plan.visitsPerDomain} visits`);
	console.log(`Total: ${plan.total} visits. Reruns append; existing data is not replaced.`);
	if (!apply)
		console.log('Review the target and back up your development data, then repeat with --apply.');
}

async function appendVisits(plan) {
	const file = await stat(plan.databasePath).catch(() => {
		throw new Error(
			'Cannot access the existing visits database; start the application normally before seeding'
		);
	});
	if (!file.isFile()) throw new Error('Configured visits database is not a regular file');
	const db = await openDb(plan.databasePath);
	let inserted = 0;
	try {
		// Validate insert columns before committing any rows, without changing schema.
		const columns = [
			'domain',
			'path',
			'outcome',
			'visited_at',
			'ip',
			'user_agent',
			'accept_language',
			'browser',
			'os'
		];
		await db.selectFrom('visits').select(columns).limit(0).execute();
		let batch = [];
		for (const visit of generateVisits(plan)) {
			batch.push(visit);
			if (batch.length === batchSize) {
				await appendBatch(db, batch);
				inserted += batch.length;
				batch = [];
				await setImmediate();
			}
		}
		if (batch.length > 0) {
			await appendBatch(db, batch);
			inserted += batch.length;
		}
		console.log(`Appended ${inserted} synthetic visits.`);
	} catch (error) {
		console.error(
			`Stopped after ${inserted} committed visits; completed batches remain in the database.`
		);
		throw error;
	} finally {
		await db.destroy();
	}
}

async function appendBatch(db, visits) {
	await db.transaction().execute(async (transaction) => {
		for (const visit of visits) await insertVisit(transaction, visit);
	});
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
