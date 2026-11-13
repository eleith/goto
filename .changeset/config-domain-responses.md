---
'@goto/web': minor
'@goto/worker': minor
'@goto/cli': minor
---

Separate domain `root` responses from named links and use `link_defaults` consistently at global and domain levels. Root and fallback responses require a destination URL and support explicit redirect status and query forwarding. Domain fallbacks replace global responses as whole objects; 404 is only the default when no fallback exists. Reject `/` link entries, old defaults and scalar fallback syntax directly.
