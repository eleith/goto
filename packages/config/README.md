# @goto/config

GoTo’s shared YAML loader. Both the web app and the worker use it.

Start with the [example YAML](../../examples/goto.yaml) or look up a field in the [schema](src/config.schema.json).

Use `loadConfigFile()` to read a file, `parseConfig()` for YAML text, or `loadConfig()` for an already parsed value. The loader applies defaults and prepares the redirect lookup. The result includes server-only settings, including secrets. Don’t send it to the browser.
