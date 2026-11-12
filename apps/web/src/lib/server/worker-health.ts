const HEALTH_TIMEOUT_MS = 3_000;

export async function isWorkerReachable(workerBaseUrl: string): Promise<boolean> {
	try {
		const response = await fetch(`${workerBaseUrl.replace(/\/+$/, '')}/healthz`, {
			signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
		});
		await response.body?.cancel();
		return response.ok;
	} catch {
		return false;
	}
}
