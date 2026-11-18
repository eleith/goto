---
'@goto/web': minor
'@goto/cli': minor
'@goto/worker': minor
---

Maintain retained visit statistics incrementally in UTC-day SQLite rows instead of rebuilding complete report snapshots. Commit daily updates with visit processing markers, expire raw visits and daily contributions together, and retire fully expired aggregate rows by event time. Missing daily contributions warn without blocking raw cleanup. Admin analytics use the current retention window and show last-visit activity rather than inferred job freshness. Zero retention keeps collection and scheduled analytics disabled, with a one-off purge of existing data.
