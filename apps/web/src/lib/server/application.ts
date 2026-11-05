import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import type { NewVisit } from '@goto/db';
import {
	loadConfigFile,
	resolveConfigPath,
	startConfigReloading,
	type ConfigOptions,
	type PreparedConfiguration
} from '@goto/config';
import { createAuthentication, type Authentication } from './auth/index.js';
import { prepareSnapshot, type ConfigurationSnapshot } from './snapshot.js';
import { createVisitRecorder } from './visits/recorder.js';

export interface Application {
	currentSnapshot(): ConfigurationSnapshot;
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

function startupSettings({ configuration }: PreparedConfiguration) {
	return {
		siteUrl: configuration.site.url,
		auth: configuration.auth,
		databasePath: configuration.database.path
	};
}

export async function createApplication(options: ConfigOptions = {}): Promise<Application> {
	const captured = {
		env: { ...(options.env ?? process.env) },
		cwd: options.cwd ?? process.cwd()
	};
	const path = resolveConfigPath(captured);
	const initial = await loadConfigFile(path, captured);
	const initialSettings = startupSettings(initial);
	const startup = structuredClone(initialSettings);
	let snapshot = prepareSnapshot(initial);
	const authentication = createAuthentication(snapshot.configuration);
	const databasePath = resolve(captured.cwd, startup.databasePath);
	const collectionEnabled = snapshot.configuration.analytics.retention_months !== 0;
	const recorder = createVisitRecorder(databasePath, collectionEnabled);

	function loadConfiguration(path: string): Promise<PreparedConfiguration> {
		return loadConfigFile(path, captured);
	}

	function applyConfiguration(
		next: PreparedConfiguration,
		previous: PreparedConfiguration
	): boolean {
		const nextSettings = startupSettings(next);
		if (!isDeepStrictEqual(nextSettings, startup)) {
			reportReloadIssue('Configuration change requires restart; keeping current configuration');
			return false;
		}
		if (!isDeepStrictEqual(next, previous)) {
			const candidate = prepareSnapshot(next);
			const collectionEnabled = candidate.configuration.analytics.retention_months !== 0;
			recorder.setEnabled(collectionEnabled);
			snapshot = candidate;
		}
		return true;
	}

	function reportConfigurationFailure(): void {
		reportReloadIssue('Invalid configuration update; keeping current configuration');
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
		await recorder.stop();
		throw error;
	}
	const application: Application = {
		currentSnapshot() {
			return snapshot;
		},
		authentication,
		recordVisit: recorder.recordVisit,
		async close() {
			try {
				await stopReloading();
			} finally {
				await recorder.stop();
			}
		}
	};
	return application;
}
