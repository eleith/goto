---
'@goto/web': minor
'@goto/worker': minor
'@goto/cli': minor
---

Make analytics collection on/off startup-only and remove the collection-control table and insertion fence. Stop and drain both services before changing between zero and positive retention, then restart; changes between positive retention periods remain live. Keep whole-event admission drops with distinct bounded warnings for queue capacity and payload size.
