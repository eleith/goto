# @goto/config

Shared TypeBox schemas, YAML loading, environment interpolation, and effective
redirect defaults for the Goto workspace.

- `parseConfig(source, options)` parses and validates YAML text.
- `validateConfig(input, options)` validates an already parsed value.
- `loadConfigFile(path?, options)` reads a file and resolves its database path.

Options accept an explicit `env` and `cwd`. Without them, the current process
supplies those values. The default file is `config/goto.yaml`, overridable with
`CONFIG_PATH`. Relative database paths resolve against the config directory's
parent, not the shell's working directory.

The result has two parts:

- `configuration`: validated, defaulted server configuration. Omitted domain/link
  override values stay omitted. This includes authentication secrets and must not
  be sent to the browser.
- `domains`: canonical host keys with effective link settings and `provenance`
  (`builtin`, `global`, `domain`, or `link`). Explicit false overrides true.

Inputs are not mutated. Snapshot freezing/publication is the runtime's concern.

Keys are literal. String values support `${VAR}`, `${VAR:-fallback}`, and `$$`;
variable names follow the reference convention of uppercase letters, digits and
underscores. Empty values count as set; replacement values are not expanded again.
There is no numeric/boolean coercion or implicit auth-secret environment lookup.
Omitting `auth.secret` leaves it unset for runtime generation.

Paths are logical text, not encoded URL strings. They start with one slash, do
not end in a slash except `/`, and have no spaces, control characters, backslashes,
dot segments, or `:?#[]@`. Unicode, literal percent characters, and internal
slashes are allowed. Invalid keys fail validation; nothing is silently rewritten.
Request decoding is not performed by this package's config loader.

Failures throw the same generic `ConfigError` without authored keys, locations,
expanded values, or YAML parser snippets. There are no repair modes, redaction
frameworks, or path-specific exception classes.
