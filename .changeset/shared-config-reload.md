---
'@goto/web': patch
'@goto/cli': patch
'@goto/worker': patch
---

Use the same reload rules in web and worker. Stop both services before changing either database path, the app origin, authentication, or reducing retention or switching detailed analytics on or off. Then start both with the new configuration. If saved while running, these edits leave the previous configuration active rather than restarting one service. Link edits and increases between positive retention periods can still take effect live.
