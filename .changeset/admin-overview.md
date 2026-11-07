---
'@goto/web': minor
'@goto/worker': minor
'@goto/cli': minor
---

Add an authenticated admin overview, domain summaries and dedicated link pages with current inventory and retained visits. One hourly background job, with scheduled jitter, prepares all reports in SQLite and coordinates retention cleanup. Admin pages read prepared snapshots directly and display their update time; no reporting API, token or worker URL is required. The job also prepares UTC daily, weekly and monthly series and browser/OS family counts for later visualization. Charts and the Health page are not included.
