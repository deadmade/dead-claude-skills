# Spec: `--json` output flag

## Goal

Scripts parse our human-readable output with `grep` and `awk`, and they break each time we reword a message. A `--json` flag gives them a stable, machine-readable format.

## Behavior

- `--json` is a global flag that every subcommand accepts. We considered adding it only to some subcommands, but a global flag means users don't have to learn which commands support it.
- With `--json`, stdout carries exactly one JSON document and nothing else. Progress messages, warnings and prompts go to stderr.
- `--json` never prompts for input, because a script can't answer. A command that would need to prompt exits with an error instead.
- Without `--json`, output is unchanged.

## Output shape

Success:

```json
{"ok": true, "data": { ... }}
```

Failure:

```json
{ "ok": false, "error": { "code": "not_found", "message": "No such project: foo" } }
```

- `data` holds the subcommand's result. Its shape is defined per subcommand and documented in `--help`.
- `error.code` is a stable snake_case identifier that scripts can branch on. `error.message` is for people and may change.
- Exit codes stay the same as without `--json`. A script can rely on either the exit code or `ok`.

## Stability

- The JSON shape is a public interface. We may add fields in a minor release; removing or renaming one requires a major release.
- Consumers must ignore fields they don't recognize.

## Out of scope

- Streaming output for long-running commands, such as newline-delimited JSON (NDJSON). We'll add it when a user asks for it.
- Other formats, such as YAML or comma-separated values (CSV). We chose a single `--json` flag over a general `--format` option because JSON is the only format anyone has requested. If we add a second format later, `--format json` will become the canonical spelling and `--json` will remain as an alias.
