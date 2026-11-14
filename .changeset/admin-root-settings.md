---
'@goto/web': minor
'@goto/worker': minor
'@goto/cli': minor
---

Use one `(root)` inventory row to reach Root details and remove redundant Root summary navigation. Expose root/fallback response settings and named-link settings, inheritance, schedules and tags without changing existing URLs.

Count every tracked `/` request as a valid Root visit, independent of response status. Apply that meaning to legacy Root visits during report aggregation without rewriting raw rows. Details version 3 keeps totals, charts and browser/OS breakdowns consistent; older prepared details stay unavailable until normal report refresh. Invalid clicks remain limited to non-root traffic.
