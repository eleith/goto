import type { Adapter, Emulator } from '@sveltejs/kit';
import { getRequest, setResponse } from '@sveltejs/kit/node';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRunnableDevEnvironment, type ViteDevServer } from 'vite';
import {
	bindApplication,
	requestApplication,
	requestOrigin,
	requestSnapshot
} from '../src/lib/server/request-context.ts';
import { createApplicationLifecycle } from './lifecycle.ts';
import { watchDatabase } from './database-compiler.ts';

type ServerEntry = typeof import('../src/lib/server/entry.js');
type RequestOptions = Parameters<typeof getRequest>[0];
type PlatformDetails = Parameters<NonNullable<Emulator['platform']>>[0];
type Next = (error?: unknown) => void;

export class DevelopmentServer {
	private readonly entry: string;
	private readonly restartFiles: Set<string>;
	private server: ViteDevServer | undefined;
	private listening: Promise<void> | undefined;
	private databaseOutput: string | undefined;
	private stopCompiling: (() => void) | undefined;
	private readonly lifecycle = createApplicationLifecycle(this.createApplication.bind(this));

	constructor(entry: string, applicationFiles: string[]) {
		this.entry = entry;
		this.restartFiles = new Set(applicationFiles);
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
		const workerUrl = import.meta.resolve('@goto/db/visit-worker');
		this.databaseOutput = dirname(fileURLToPath(workerUrl));
		// Compile before watching output so the initial emit does not restart Vite.
		this.stopCompiling = watchDatabase(workerUrl);
		server.watcher.add(this.databaseOutput);
		server.watcher.on('change', this.applicationChanged);
	}

	async close(): Promise<void> {
		this.server?.watcher.off('change', this.applicationChanged);
		try {
			this.stopCompiling?.();
		} finally {
			await this.lifecycle.stop();
		}
	}

	request(options: RequestOptions, convert = getRequest): Request {
		const origin = requestOrigin(options.request);
		const request = convert({ ...options, ...(origin === undefined ? {} : { base: origin }) });
		const application = requestApplication(options.request);
		if (application)
			bindApplication(request, application, origin, requestSnapshot(options.request));
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
		const application = await this.lifecycle.start();
		return { ...platform, application, snapshot: application.currentSnapshot() } as App.Platform;
	}

	private async loadServerEntry(): Promise<ServerEntry> {
		if (!this.server || !this.listening) throw new Error('Development server is unavailable');
		await this.listening;
		const environment = this.server.environments.ssr!;
		if (!isRunnableDevEnvironment(environment))
			throw new Error('Expected runnable SSR environment');
		return environment.runner.import<ServerEntry>(this.entry);
	}

	private async createApplication() {
		const serverEntry = await this.loadServerEntry();
		return serverEntry.createApplication();
	}

	private handleRequest(request: IncomingMessage, response: ServerResponse, next: Next): void {
		void this.dispatch(request, response, next).catch(() => {
			this.server!.config.logger.error('Goto request handling failed');
			if (response.headersSent) response.destroy();
			else response.writeHead(503, { 'cache-control': 'no-store' }).end();
		});
	}

	private async dispatch(request: IncomingMessage, response: ServerResponse, next: Next) {
		const serverEntry = await this.loadServerEntry();
		const application = await this.lifecycle.start();
		const publicDir = this.server!.config.publicDir;
		const result = await serverEntry.handleIngress(
			application,
			request,
			process.env,
			'http',
			(path, method) => serveRedirectHostAsset(publicDir, path, method)
		);
		if (result) {
			setResponse(response, result);
			return;
		}
		const cacheControl = serverEntry.adminCacheControl(request);
		if (cacheControl) response.setHeader('Cache-Control', cacheControl);
		next();
	}

	private readonly applicationChanged = (file: string): void => {
		const databaseChanged =
			this.databaseOutput !== undefined &&
			file.endsWith('.js') &&
			!relative(this.databaseOutput, file).startsWith('..');
		if (this.restartFiles.has(file) || databaseChanged) {
			setImmediate(() => void this.restart());
		}
	};

	private async restart(): Promise<void> {
		try {
			await this.server?.restart();
		} catch {
			this.server?.config.logger.error('Goto restart failed');
		}
	}
}

async function serveRedirectHostAsset(publicDir: string, path: string, method: 'GET' | 'HEAD') {
	const headers = { 'cache-control': 'no-store' };
	try {
		const contents = await readFile(join(publicDir, path));
		return new Response(method === 'HEAD' ? null : new Uint8Array(contents), {
			headers: {
				...headers,
				'content-type': path.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
				'content-length': String(contents.byteLength)
			}
		});
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return new Response(null, { status: 404, headers });
		}
		throw error;
	}
}
