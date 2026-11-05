import { createServer, type Server } from 'node:http';

export function createHealthServer(): Server {
	return createServer((request, response) => {
		response.setHeader('cache-control', 'no-store');
		if (request.method === 'GET' && request.url === '/healthz') {
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ status: 'ok' }));
			return;
		}
		response.writeHead(404).end();
	});
}
