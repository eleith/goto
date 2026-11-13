import type { PreparedLink } from '@goto/config';
import type { Immutable } from './snapshot.js';

export type LinkState = 'active' | 'disabled' | 'scheduled' | 'expired';

export function currentLinkState(link: Immutable<PreparedLink>, now: number): LinkState {
	if (!link.enabled) return 'disabled';
	if (link.valid_from !== undefined && now < Date.parse(link.valid_from)) return 'scheduled';
	if (link.valid_until !== undefined && now >= Date.parse(link.valid_until)) return 'expired';
	return 'active';
}
