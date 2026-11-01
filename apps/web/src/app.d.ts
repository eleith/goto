import type { Application } from './lib/server/application.js';

declare global {
	namespace App {
		interface Locals {
			application: Application;
		}
		interface Platform {
			application?: Application;
		}
	}
}

export {};
