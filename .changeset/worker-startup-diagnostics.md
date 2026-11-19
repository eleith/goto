---
'@goto/web': patch
'@goto/cli': patch
'@goto/worker': patch
---

Report stable worker startup failure codes with curated storage, SQLite and health-listener reasons. Use existing configuration diagnostics for invalid startup options and identify migrations without parsing exception messages. Keep raw exceptions, SQL, filesystem paths and configuration values out of logs. Report failed-startup cleanup separately without masking the original failure. Startup still exits unsuccessfully and does not announce readiness on failure; no database repair, reset, retry or health policy is added.
