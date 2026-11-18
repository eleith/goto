import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import type { NewVisit } from '@goto/db';
import {
	ConfigError,
	formatConfigError,
	formatConfigWarnings,
	loadConfigFile,
	resolveConfigPath,
	startConfigReloading,
	type ConfigOptions,
	type PreparedConfiguration
} from '@goto/config';
import { createAuthentication, type Authentication } from './auth/index.js';
import { prepareSnapshot, type ConfigurationSnapshot } from './snapshot.js';
import { readStoredLinkVisitCounts } from './visits/counts.js';
import { createVisitWriter } from './visits/writer.js';

export interface Application {
	currentSnapshot(): ConfigurationSnapshot;
	linkVisitCount(domain: string, path: string): number;
	authentication?: Authentication;
	recordVisit?(visit: NewVisit): void;
	close?(): void | Promise<void>;
}

function reportReloadIssue(message: string): void {
	try {
		console.warn(message);
	} catch {
		return;
	}
}

function reportConfigurationWarnings({ warnings }: PreparedConfiguration): void {
	if (warnings.length > 0) reportReloadIssue(formatConfigWarnings(warnings));
}

function startupSettings({ configuration }: PreparedConfiguration) {
	return {
		appUrl: configuration.url.app,
		auth: configuration.auth,
		databasePath: configuration.database.path,
		detailedAnalyticsEnabled: configuration.analytics.retention_months !== 0
	};
}

export async function createApplication(options: ConfigOptions = {}): Promise<Application> {
	const captured = {
		env: { ...(options.env ?? process.env) },
		cwd: options.cwd ?? process.cwd()
	};
	const path = resolveConfigPath(captured);
	const initial = await loadConfigFile(path, captured).catch((error: unknown) => {
		if (error instanceof ConfigError) console.error(formatConfigError(error));
		throw error;
	});
	reportConfigurationWarnings(initial);
	const initialSettings = startupSettings(initial);
	const startup = structuredClone(initialSettings);
	let snapshot = prepareSnapshot(initial);
	const authentication = createAuthentication(snapshot.configuration);
	const databasePath = resolve(captured.cwd, startup.databasePath);
	const visitWriter = createVisitWriter(databasePath);
	const linkVisitCounts = new Map<string, number>();
	let closed = false;
	try {
		await visitWriter.waitUntilReady();
		await loadSavedVisitCountsForNewLinks(snapshot, linkVisitCounts, databasePath);
	} catch (error) {
		await visitWriter.stop();
		throw error;
	}

	function loadConfiguration(path: string): Promise<PreparedConfiguration> {
		return loadConfigFile(path, captured);
	}

	async function applyConfiguration(
		next: PreparedConfiguration,
		previous: PreparedConfiguration
	): Promise<boolean> {
		if (closed) return false;
		const nextSettings = startupSettings(next);
		if (nextSettings.detailedAnalyticsEnabled !== startup.detailedAnalyticsEnabled) {
			reportReloadIssue(
				'Detailed analytics change requires coordinated restart; previous configuration remains active until a valid update is loaded'
			);
			return false;
		}
		if (!isDeepStrictEqual(nextSettings, startup)) {
			reportReloadIssue(
				'Configuration change requires restart; previous configuration remains active until a valid update is loaded'
			);
			return false;
		}
		if (!isDeepStrictEqual(next, previous)) {
			const candidate = prepareSnapshot(next);
			try {
				await loadSavedVisitCountsForNewLinks(candidate, linkVisitCounts, databasePath);
			} catch {
				reportReloadIssue(
					'Link visit counts unavailable; previous configuration remains active until a valid update is loaded'
				);
				return false;
			}
			if (closed) return false;
			snapshot = candidate;
		}
		if (!isDeepStrictEqual(next.warnings, previous.warnings)) {
			reportConfigurationWarnings(next);
		}
		return true;
	}

	function reportConfigurationFailure(): void {
		reportReloadIssue(
			'Invalid configuration update; previous configuration remains active until a valid update is loaded'
		);
	}

	const reloadOptions = {
		path,
		initial,
		load: loadConfiguration,
		onChange: applyConfiguration,
		onError: reportConfigurationFailure
	};
	let stopReloading: () => Promise<void>;
	try {
		stopReloading = await startConfigReloading(reloadOptions);
	} catch (error) {
		await visitWriter.stop();
		throw error;
	}
	const application: Application = {
		currentSnapshot() {
			return snapshot;
		},
		linkVisitCount(domain, path) {
			return linkVisitCounts.get(linkKey(domain, path)) ?? 0;
		},
		authentication,
		recordVisit(visit) {
			if (closed) return;
			incrementLinkVisitCount(visit, linkVisitCounts);
			visitWriter.queueVisit(visit);
		},
		async close() {
			closed = true;
			try {
				await stopReloading();
			} finally {
				await visitWriter.stop();
			}
		}
	};
	return application;
}

async function loadSavedVisitCountsForNewLinks(
	candidate: ConfigurationSnapshot,
	linkVisitCounts: Map<string, number>,
	databasePath: string
): Promise<void> {
	const newLinks = Object.entries(candidate.domains).flatMap(([domain, configured]) =>
		Object.keys(configured.links)
			.filter((path) => !linkVisitCounts.has(linkKey(domain, path)))
			.map((path) => ({ domain, path }))
	);
	if (newLinks.length === 0) return;
	const savedCounts = await readStoredLinkVisitCounts(databasePath, newLinks);
	const recoveredCounts = new Map<string, number>();
	for (const { domain, path, visits } of savedCounts) {
		recoveredCounts.set(linkKey(domain, path), visits);
	}
	for (const { domain, path } of newLinks) {
		const key = linkKey(domain, path);
		if (!linkVisitCounts.has(key)) linkVisitCounts.set(key, recoveredCounts.get(key) ?? 0);
	}
}

function incrementLinkVisitCount(visit: NewVisit, linkVisitCounts: Map<string, number>): void {
	if (visit.outcome !== 'valid' || visit.path === '/') return;
	const key = linkKey(visit.domain, visit.path);
	const current = linkVisitCounts.get(key);
	if (current !== undefined) linkVisitCounts.set(key, current + 1);
}

function linkKey(domain: string, path: string): string {
	return JSON.stringify([domain, path]);
}
