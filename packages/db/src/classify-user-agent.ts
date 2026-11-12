function browserName(userAgent: string): string {
	if (
		userAgent.includes('edg/') ||
		userAgent.includes('edga/') ||
		userAgent.includes('edgios/') ||
		userAgent.includes('edge/')
	)
		return 'Edge';
	if (userAgent.includes('opr/') || userAgent.includes('opera/')) return 'Opera';
	if (userAgent.includes('firefox/') || userAgent.includes('fxios/')) return 'Firefox';
	if (
		userAgent.includes('chrome/') ||
		userAgent.includes('crios/') ||
		userAgent.includes('chromium/')
	)
		return 'Chrome';
	if (userAgent.includes('safari/')) return 'Safari';
	return 'Other';
}

function operatingSystemName(userAgent: string): string {
	if (userAgent.includes('windows')) return 'Windows';
	if (userAgent.includes('android')) return 'Android';
	if (userAgent.includes('iphone') || userAgent.includes('ipad') || userAgent.includes('ipod'))
		return 'iOS';
	if (userAgent.includes('macintosh') || userAgent.includes('mac os x')) return 'macOS';
	if (userAgent.includes('cros ')) return 'ChromeOS';
	if (userAgent.includes('linux')) return 'Linux';
	return 'Other';
}

export function classifyUserAgent(userAgent: string | null | undefined): {
	browser: string;
	os: string;
} {
	const normalizedUserAgent = userAgent?.toLowerCase() ?? '';
	return {
		browser: browserName(normalizedUserAgent),
		os: operatingSystemName(normalizedUserAgent)
	};
}
