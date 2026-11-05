---
'@goto/web': minor
'@goto/worker': minor
---

Record request-time valid and invalid visit outcomes for known redirect domains, including base URLs and inactive or unmatched paths. Preserve existing visits as valid without consulting current YAML, while keeping HEAD, malformed requests, unknown hosts, and disabled analytics untracked.
