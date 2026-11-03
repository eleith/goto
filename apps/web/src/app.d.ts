import type { Application } from './lib/server/application.js';
import type { ConfigurationSnapshot } from './lib/server/snapshot.js';

declare global {
	namespace App {
		interface Locals {
			application: Application;
			snapshot: ConfigurationSnapshot;
		}
		interface Platform {
			application?: Application;
			snapshot?: ConfigurationSnapshot;
		}
	}
}

export {};
