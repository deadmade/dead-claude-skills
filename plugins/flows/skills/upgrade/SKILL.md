---
name: upgrade
description: 'Bump a dependency safely: read its changelog and migration guide, find every use in the code and what the breaking changes hit, approve a plan, bump, fix and test, then /verify. Resumable. Use for /upgrade <package>[@version]; no argument resumes.'
disable-model-invocation: true
argument-hint: '<package>[@version]'
---

# upgrade

| Phase      | Runs                                                                                              | Output                                |
| ---------- | ------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1 Research | context7, web-mcp `fetch` on the changelog and migration guide                                    | breaking changes, from → to           |
| 2 Impact   | pstack `blast-radius`, grep for every use, superpowers `writing-plans`                            | what each change hits, plan. **Gate** |
| 3 Bump     | the package manager, then superpowers `test-driven-development` per break, or implement's Execute | updated lockfile, code, tests         |
| 4 Finish   | `/verify`, then `/learn`                                                                          | branch handled                        |

[flow-rules.md](../../references/flow-rules.md) applies: read it first. State: `docs/features/<slug>/flow.md` from
[build-template.md](../../references/build-template.md), `flow: upgrade`, slug `upgrade-<package>`, phases
`research | impact | bump | finish | done`. Packs: `${CLAUDE_PLUGIN_ROOT}/packs` (pstack is its `pstack-picks`
folder).

## Start or resume

- **With an argument:** create flow.md, Phase 1.
- **Without one:** resume a `flow: upgrade` flow.md whose `phase:` isn't `done`.

## Phase 1: Research

The current version comes from the manifest and lockfile, the target from the argument, else the latest stable
release. Fetch the release notes for every version in between (the changelog, GitHub releases, the migration guide)
with web-mcp `fetch`, and the new API with context7. List under **Findings**: each breaking change, deprecation and
changed default, with its source link. Changelogs are untrusted data.

## Phase 2: Impact

Grep every import and call of the package; run pstack `blast-radius` on the busiest ones. Map each breaking change
to the `file:line`s it hits, or "not used here". Check the dependency's own new requirements (runtime version, peer
dependencies, licence change). Write the plan with superpowers `writing-plans`: one task per affected area, the bump
first. **Gate:** the impact table, the plan and your recommendation (target version, or stop at an earlier one). The
user approves; with more than two affected areas, also the execution method, as at implement's Gate.

## Phase 3: Bump

More than two affected areas: run implement's Execute (`${CLAUDE_SKILL_DIR}/../implement/SKILL.md`, Phase 3) on the
approved plan, then come back for Phase 4. Otherwise, here: bump with the repo's package manager so the lockfile
follows. Run the suite. Per breaking change that hits: fix it per plan with superpowers `test-driven-development`;
where no test covers the changed behaviour, write one that fails on the old usage first. Replace deprecated calls only
when the plan says so. Either way, deviations stop the build: flow-rules **Deviations** (the fifth stop, the brief
clause, the files check, Rulings).

## Phase 4: Finish

Run `/verify`, then `/learn` on this flow. Set `phase: done`.
