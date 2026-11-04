function browserFamily(ua: string): string {
	if (ua.includes('edg/') || ua.includes('edga/') || ua.includes('edgios/') || ua.includes('edge/'))
		return 'Edge';
	if (ua.includes('opr/') || ua.includes('opera/')) return 'Opera';
	if (ua.includes('firefox/') || ua.includes('fxios/')) return 'Firefox';
	if (ua.includes('chrome/') || ua.includes('crios/') || ua.includes('chromium/')) return 'Chrome';
	if (ua.includes('safari/')) return 'Safari';
	return 'Other';
}

function operatingSystem(ua: string): string {
	if (ua.includes('windows')) return 'Windows';
	if (ua.includes('android')) return 'Android';
	if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'iOS';
	if (ua.includes('macintosh') || ua.includes('mac os x')) return 'macOS';
	if (ua.includes('cros ')) return 'ChromeOS';
	if (ua.includes('linux')) return 'Linux';
	return 'Other';
}

export function classifyUserAgent(userAgent: string | null | undefined): {
	browser: string;
	os: string;
} {
	const ua = userAgent?.toLowerCase() ?? '';
	return { browser: browserFamily(ua), os: operatingSystem(ua) };
}
