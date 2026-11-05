---
'@goto/web': minor
'@goto/cli': minor
'@goto/worker': minor
---

Replace analytics enabled/retention-days settings with finite calendar-month retention. Apply live retention changes through the worker service's jittered hourly OpenWorkflow schedule and purge analytics data when retention is zero. Keep Piscina ingestion-only, serialize SQLite migrations, and fence queued writes across collection changes.
