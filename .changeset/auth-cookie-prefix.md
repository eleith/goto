---
'@goto/web': patch
'@goto/worker': patch
'@goto/cli': patch
---

Namespace authentication cookies with the native Better Auth `goto` prefix so Goto does not overwrite other localhost apps' default authentication cookies. Existing Goto sessions require a fresh sign-in; unrelated cookies are not removed.
