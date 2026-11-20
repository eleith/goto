---
'@goto/web': minor
'@goto/worker': minor
'@goto/cli': minor
---

Allow the app host to serve short links when it is also listed under `domains`. App routes, assets, and development tooling paths are reserved on the shared host. The app no longer sends `/` to `/admin` by default; configure a domain's Root response to restore that shortcut.
