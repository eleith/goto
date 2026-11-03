import { isDeepStrictEqual } from 'node:util';
import {
	loadConfigFile,
	resolveConfigPath,
	startConfigReloading,
	type ConfigOptions,
	type PreparedConfiguration
} from '@goto/config';
import { prepareSnapshot, type ConfigurationSnapshot } from './snapshot.js';

export interface Application {
	currentSnapshot(): ConfigurationSnapshot;
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
	const startup = structuredClone(startupSettings(initial));
	let snapshot = prepareSnapshot(initial);
	const stop = await startConfigReloading({
		path,
		initial,
		load: (path) => loadConfigFile(path, captured),
		onChange(next, previous) {
			if (!isDeepStrictEqual(startupSettings(next), startup)) {
				reportReloadIssue('Configuration change requires restart; keeping current configuration');
				return false;
			}
			if (!isDeepStrictEqual(next, previous)) snapshot = prepareSnapshot(next);
			return true;
		},
		onError() {
			reportReloadIssue('Invalid configuration update; keeping current configuration');
		}
	});
	const application: Application = { currentSnapshot: () => snapshot, close: stop };
	return application;
}
