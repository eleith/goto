---
'@goto/web': patch
'@goto/cli': patch
'@goto/worker': patch
---

Make the default admin origin independent of the listener's `PORT`: `http://localhost:5173` in development and `http://localhost:3000` otherwise. Set `url.app` explicitly if your admin origin differs, including when using a custom port. Listener behavior is unchanged.
