---
'@goto/web': minor
'@goto/worker': minor
'@goto/cli': minor
---

Add a read-only Health page with safe active settings, report data cutoff and a manual bounded check of the existing worker health endpoint. Use the configured worker base URL without adding a startup dependency. Make the worker check and its result prominent with a bordered action button, checking indicator and status banner. Warn when enabled analytics reports are unavailable or more than 75 minutes old.
