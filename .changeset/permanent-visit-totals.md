---
'@goto/web': minor
'@goto/cli': minor
'@goto/worker': minor
---

Keep permanent numeric visit totals through hourly worker rollup while retaining finite daily analytics separately. Capture minimal visits when detailed analytics are disabled, count them before removal, and recover live named-link visit counts from stored totals plus unprocessed visits on startup. Show read-only all-time visits in the admin details, independently of the analytics period. Web startup waits for worker health in Docker, and rejected configuration reloads keep the prior working configuration with a clear warning. This prelaunch change uses a fresh schema; it does not convert existing databases. Named-link visit limits are not introduced yet.
