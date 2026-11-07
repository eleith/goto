import type { PreparedLink } from '@goto/config';
import type { Immutable } from './snapshot.js';

export function currentLinkState(link: Immutable<PreparedLink>, now: number): string {
	if (!link.enabled) return 'Disabled';
	if (link.valid_from !== undefined && now < Date.parse(link.valid_from)) return 'Scheduled';
	if (link.valid_until !== undefined && now >= Date.parse(link.valid_until)) return 'Expired';
	return 'Active';
}
