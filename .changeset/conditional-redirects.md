---
'@goto/web': minor
'@goto/cli': minor
'@goto/worker': minor
---

Add ordered language and OS redirect rules for named links, with read-only rules on the Link page. Show browser and OS breakdowns on Overview alongside accepted languages. Reuse accepted-language classification and the existing approximate OS detector while preserving canonical capture and nonblocking visit recording. Separate configuration validation from routing lookup construction; object-based callers now use loadConfig instead of the former validateConfig preparation API.
