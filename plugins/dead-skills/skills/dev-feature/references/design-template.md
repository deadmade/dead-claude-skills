# Design template

Copy everything below the line into `docs/features/<slug>/design.md`, with the feature name filled in. Nothing else:
the user writes the content. Private helpers and imports don't belong here.

---

```markdown
# <Feature>: design

> Written by the developer. Claude only transcribes the developer's own words into this file.

## Scope
<!-- What this slice does and explicitly doesn't do. -->

## Touched code
<!-- Existing classes, modules or files, and what changes in each. -->

## New code
<!-- New classes or modules and the one responsibility of each. -->

## Public interface
<!-- Signatures: methods, functions, endpoints, events. -->

## External calls
<!-- APIs, SDK calls, webhooks, queues: what is called, when, with what. -->

## Libraries
<!-- Name, version, what for. -->

## Data flow
<!-- The happy path, step by step. -->

## Failure paths
<!-- For each step that can fail: what fails, and what the system does. -->

## Tests
<!-- One per behavior and per failure path, named in plain words. -->
```
