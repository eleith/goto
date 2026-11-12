import { afterEach, expect, test, vi } from 'vitest';
import { isWorkerReachable } from './worker-health.js';

afterEach(() => vi.restoreAllMocks());

test('checks the configured worker base with a bounded health request', async () => {
	const signal = new AbortController().signal;
	const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
	const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

	expect(await isWorkerReachable('http://goto-worker:9000/private/')).toBe(true);
	expect(request).toHaveBeenCalledExactlyOnceWith('http://goto-worker:9000/private/healthz', {
		signal
	});
	expect(timeout).toHaveBeenCalledExactlyOnceWith(3_000);
});

test('an unsuccessful health response is unreachable', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }));
	expect(await isWorkerReachable('http://goto-worker:9000')).toBe(false);
});

test('transport and timeout failures are unreachable without exposing errors', async () => {
	const request = vi.spyOn(globalThis, 'fetch');
	request.mockRejectedValueOnce(new Error('private connection detail'));
	expect(await isWorkerReachable('http://goto-worker:9000')).toBe(false);
	request.mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));
	expect(await isWorkerReachable('http://goto-worker:9000')).toBe(false);
});
