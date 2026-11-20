---
'@goto/web': patch
'@goto/cli': patch
'@goto/worker': patch
---

Use 30 days per configured retention month for detailed analytics. Reports and cleanup share rolling 90-, 270-, or 360-day windows that do not move backward at month-end. Zero retention and lifetime visit totals are unchanged.
