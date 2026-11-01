import type { Adapter, Emulator } from '@sveltejs/kit';
import { getRequest, setResponse } from '@sveltejs/kit/node';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRunnableDevEnvironment, type ViteDevServer } from 'vite';
import {
	bindApplication,
	requestApplication,
	requestOrigin
} from '../src/lib/server/request-context.ts';
import { createApplicationLifecycle } from './lifecycle.ts';

type Runtime = typeof import('../src/lib/server/entry.js');
type RequestOptions = Parameters<typeof getRequest>[0];
type PlatformDetails = Parameters<NonNullable<Emulator['platform']>>[0];
type Next = (error?: unknown) => void;

export class DevelopmentServer {
	private readonly entry: string;
	private readonly applicationFile: string;
	private server: ViteDevServer | undefined;
	private listening: Promise<void> | undefined;
	private readonly lifecycle = createApplicationLifecycle(this.createApplication.bind(this));

	constructor(entry: string, applicationFile: string) {
		this.entry = entry;
		this.applicationFile = applicationFile;
	}

	configure(server: ViteDevServer): void {
		const httpServer = server.httpServer;
		if (!httpServer) throw new Error('Expected development HTTP server');
		this.server = server;
		this.listening = new Promise((resolve) => {
			if (httpServer.listening) resolve();
			else httpServer.once('listening', resolve);
		});
		server.middlewares.use(this.handleRequest.bind(this));
		server.watcher.on('change', this.applicationChanged);
	}

	async close(): Promise<void> {
		this.server?.watcher.off('change', this.applicationChanged);
		await this.lifecycle.stop();
	}

	request(options: RequestOptions, convert = getRequest): Request {
		const origin = requestOrigin(options.request);
		const request = convert({ ...options, ...(origin === undefined ? {} : { base: origin }) });
		const application = requestApplication(options.request);
		if (application) bindApplication(request, application, origin);
		return request;
	}

	async emulate(base: Adapter['emulate']): Promise<Emulator> {
		const emulator = await base?.();
		return {
			...emulator,
			platform: (details) => this.platform(details, emulator)
		};
	}

	private async platform(details: PlatformDetails, emulator?: Emulator): Promise<App.Platform> {
		const platform = await emulator?.platform?.(details);
		if (!this.server || details.prerender) return platform ?? ({} as App.Platform);
		return { ...platform, application: await this.lifecycle.start() } as App.Platform;
	}

	private async runtime(): Promise<Runtime> {
		if (!this.server || !this.listening) throw new Error('Development server is unavailable');
		await this.listening;
		const environment = this.server.environments.ssr!;
		if (!isRunnableDevEnvironment(environment))
			throw new Error('Expected runnable SSR environment');
		return environment.runner.import<Runtime>(this.entry);
	}

	private async createApplication() {
		return (await this.runtime()).createApplication();
	}

	private handleRequest(request: IncomingMessage, response: ServerResponse, next: Next): void {
		void this.dispatch(request, response, next).catch(() => {
			this.server!.config.logger.error('Goto request handling failed');
			if (response.headersSent) response.destroy();
			else response.writeHead(503, { 'cache-control': 'no-store' }).end();
		});
	}

	private async dispatch(request: IncomingMessage, response: ServerResponse, next: Next) {
		const runtime = await this.runtime();
		const application = await this.lifecycle.start();
		const result = runtime.handleIngress(application, request, process.env, 'http');
		if (result) setResponse(response, result);
		else next();
	}

	private readonly applicationChanged = (file: string): void => {
		if (file === this.applicationFile) setImmediate(() => void this.restart());
	};

	private async restart(): Promise<void> {
		try {
			await this.server?.restart();
		} catch {
			this.server?.config.logger.error('Goto restart failed');
		}
	}
}
