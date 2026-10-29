# Doc audit: readme

Scope: README.md and the install section

| #   | severity | where          | finding                   | evidence | fix (recommended) |
| --- | -------- | -------------- | ------------------------- | -------- | ----------------- |
| 1   | med      | `README.md:12` | names a flag that is gone | `--help` | drop the flag     |
| 2   | low      | `README.md:40` | the example skips a step  | diff     | add the step      |
