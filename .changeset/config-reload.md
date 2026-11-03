---
'@goto/web': patch
---

Reload valid YAML changes as immutable snapshots while retaining the last working
configuration after invalid or restart-only updates. Preserve each request's
captured configuration and stop polling with the application lifecycle.
