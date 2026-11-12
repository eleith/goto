---
'@goto/web': minor
'@goto/worker': minor
'@goto/cli': minor
---

Group application addresses under `url.app` and `url.worker`, replacing `site.url` directly. Default the private worker base URL to `http://goto-worker:9000`. Keep site branding separate and preserve existing application-origin behavior.
