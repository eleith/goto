---
'@goto/web': minor
'@goto/cli': minor
'@goto/worker': minor
---

Add optional positive `max_visits` limits to individual named links. Check recovered and locally tracked visit counts in memory, allow the final permitted GET, and use the existing inactive-link fallback or 404 once exhausted. HEAD observes availability without consuming a visit. Canonical matching aliases and conditional destinations share one allowance; changing or removing a limit preserves accumulated usage. Show configured limits and exhausted state in read-only administration, including when detailed analytics are disabled. Counts remain best effort rather than distributed exact quotas; redirects do not wait for database persistence.
