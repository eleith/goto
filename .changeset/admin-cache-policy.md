---
'@goto/web': patch
'@goto/cli': patch
'@goto/worker': patch
---

Prevent caching of admin and sign-in responses, including redirects and authentication failures. Static assets and redirect hosts keep their existing cache policy.
