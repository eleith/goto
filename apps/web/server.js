import { createServer } from 'node:http';
import process from 'node:process';
import {
	adminCacheControl,
	createApplication,
	createApplicationLifecycle,
	handleIngress,
	setResponse
} from './build/server/goto-runtime.js';

const lifecycle = createApplicationLifecycle(createApplication);
const server = createServer();
let closing = false;
let shutdownTimeout = 30_000;
let shutdownPromise;

function readNonnegativeNumber(name, fallback, maximum) {
	const value = process.env[name] ?? fallback;
	if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error();
	const number = Number(value);
	if (!Number.isFinite(number) || number > maximum) throw new Error();
	return number;
}

function shutdown() {
	if (shutdownPromise) return shutdownPromise;
	closing = true;
	const deadline = setTimeout(() => {
		server.closeAllConnections();
		process.exit(1);
	}, shutdownTimeout);
	deadline.unref();

	shutdownPromise = (async () => {
		try {
			server.closeIdleConnections();
			await new Promise((resolve, reject) => {
				server.close((error) => {
					if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
					else resolve();
				});
			});
		} finally {
			await lifecycle.stop();
		}
	})()
		.catch(() => {
			process.exitCode = 1;
			console.error('Unable to shut down server.');
		})
		.finally(() => {
			clearTimeout(deadline);
			if (process.connected) process.disconnect();
		});

	return shutdownPromise;
}

async function bootstrap() {
	if (process.env.SOCKET_PATH || Number(process.env.LISTEN_FDS ?? '0') !== 0) {
		throw new Error();
	}
	const host = process.env.HOST ?? '0.0.0.0';
	const port = readNonnegativeNumber('PORT', '3000', 65_535);
	if (!Number.isInteger(port)) throw new Error();
	shutdownTimeout = readNonnegativeNumber('SHUTDOWN_TIMEOUT', '30', 2_147_483.647) * 1000;

	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);
	process.on('disconnect', shutdown);

	await lifecycle.start();
	if (closing) return;
	const { handler } = await import('./build/handler.js');
	if (closing) return;

	server.on('request', async (request, response) => {
		response.once('finish', () => {
			if (closing) server.closeIdleConnections();
		});

		try {
			const application = await lifecycle.start();
			const result = handleIngress(application, request);
			if (result !== undefined) {
				await setResponse(response, result);
				return;
			}
			const cacheControl = adminCacheControl(request);
			if (cacheControl) response.setHeader('Cache-Control', cacheControl);
			await handler(request, response, () => {
				response.statusCode = 404;
				response.end('Not Found');
			});
		} catch {
			if (response.destroyed || response.writableEnded) return;
			if (response.headersSent) {
				response.destroy();
				return;
			}
			response.statusCode = 500;
			response.setHeader('Content-Type', 'text/plain; charset=utf-8');
			response.setHeader('Cache-Control', 'no-store');
			response.end('Internal Server Error');
		}
	});

	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen({ host, port }, () => {
			server.off('error', reject);
			resolve();
		});
	});

	server.on('error', () => {
		process.exitCode = 1;
		console.error('Server error.');
		void shutdown();
	});

	if (closing) return;
	const address = server.address();
	if (process.send && process.connected && address && typeof address !== 'string') {
		process.send({ origin: `http://localhost:${address.port}` }, (error) => {
			if (error) void shutdown();
		});
	}
}

try {
	await bootstrap();
} catch {
	process.exitCode = 1;
	console.error('Unable to start server.');
	await shutdown();
}
