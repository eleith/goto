import { loadConfigFile, type PreparedConfiguration } from '@goto/config';

export interface Application extends PreparedConfiguration {
	close?(): void | Promise<void>;
}

export async function createApplication(): Promise<Application> {
	const application = await loadConfigFile();
	return application;
}
