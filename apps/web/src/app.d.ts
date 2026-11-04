import type { Application } from './lib/server/application.js';
import type { GotoSession } from './lib/server/auth/index.js';
import type { ConfigurationSnapshot } from './lib/server/snapshot.js';

declare global {
	namespace App {
		interface Locals {
			application: Application;
			snapshot: ConfigurationSnapshot;
			auth(): Promise<GotoSession | null>;
		}
		interface Platform {
			application?: Application;
			snapshot?: ConfigurationSnapshot;
		}
	}
}

export {};
