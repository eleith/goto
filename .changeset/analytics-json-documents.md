---
'@goto/web': patch
'@goto/worker': patch
'@goto/cli': patch
---

Replace opaque analytics cache entries with versioned summary and daily-detail JSON documents identified by report scope. Separate shared analytics contracts and encoding from SQLite persistence. Keep admin reads summary-only, remove stored weekly/monthly series and shared empty/period fallbacks, and rebuild derived reports from retained visits after migration. Existing analytics collection, retention and admin behavior are unchanged.
