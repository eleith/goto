const utcFormatter = new Intl.DateTimeFormat('en', {
	dateStyle: 'medium',
	timeStyle: 'medium',
	hourCycle: 'h23',
	timeZone: 'UTC'
});

export function formatCount(value: number | null): string {
	return value === null ? '—' : value.toLocaleString('en');
}

export function formatUtc(value: string): string {
	return `${utcFormatter.format(new Date(value))} UTC`;
}

export function formatUpdated(value: number | null): string {
	if (value === null) return '';
	const formatter = new Intl.DateTimeFormat('en', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'UTC'
	});
	return `Updated ${formatter.format(value)} UTC`;
}

export function formatUpdatedCompact(value: number | null): string {
	if (value === null) return '';
	const formatter = new Intl.DateTimeFormat('en', {
		dateStyle: 'short',
		timeStyle: 'short',
		hourCycle: 'h23',
		timeZone: 'UTC'
	});
	return `Updated ${formatter.format(value)} UTC`;
}
