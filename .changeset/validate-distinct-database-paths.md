---
'@goto/cli': patch
---

Reject configurations that point the visit and worker databases at the same path. The CLI, services, and visit seeder now enforce the same rule when loading YAML.
