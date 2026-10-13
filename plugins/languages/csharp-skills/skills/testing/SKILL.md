---
name: testing
description: "C#/.NET only. Running, writing, filtering and analyzing .NET tests (MSTest, xUnit, NUnit, TUnit), coverage, test smells, test framework migrations. Index of Microsoft's .NET skills for these."
paths:
  - "**/*.cs"
  - "**/*.csproj"
  - "**/*.sln"
  - "**/*.slnx"
  - "**/*.props"
  - "**/*.targets"
  - "**/*.razor"
  - "**/*.xaml"
  - "**/global.json"
---

# C#/.NET skills: testing

Microsoft's .NET skills for this area (vendored from dotnet/skills). Pick the one that matches the task, read its
SKILL.md with the Read tool, and follow it. When a skill names another skill, read
`${CLAUDE_PLUGIN_ROOT}/library/<that-name>/SKILL.md`.

| Skill | Use for | Path |
| --- | --- | --- |
| assertion-quality | Analyze assertion quality, depth, variety, and false confidence in existing tests. | `${CLAUDE_PLUGIN_ROOT}/library/assertion-quality/SKILL.md` |
| code-testing | ALWAYS USE for test work that requires changes: write, add, generate, repair, or strengthen tests for existing code in xUnit, MSTest, NUnit, pytest, Vitest/Jest, Go, or another framework. | `${CLAUDE_PLUGIN_ROOT}/library/code-testing/SKILL.md` |
| coverage-analysis | Activation requires either supplied .NET coverage reports/percentages/line, branch, or condition metrics, or an explicit request to collect .NET coverage for analysis. | `${CLAUDE_PLUGIN_ROOT}/library/coverage-analysis/SKILL.md` |
| crap-score | Calculates CRAP (Change Risk Anti-Patterns) for a named .NET method, class, or file. | `${CLAUDE_PLUGIN_ROOT}/library/crap-score/SKILL.md` |
| detect-static-dependencies | ACTIVATION PREREQUISITE: the request or discovered target must explicitly identify C#, .NET, `.cs`, or `.csproj`; otherwise stay dormant without invoking this skill. | `${CLAUDE_PLUGIN_ROOT}/library/detect-static-dependencies/SKILL.md` |
| find-untested-sources | MANDATORY for static source-to-test pairing: find or list source files/modules without corresponding tests, or suggest test locations from repository structure. | `${CLAUDE_PLUGIN_ROOT}/library/find-untested-sources/SKILL.md` |
| generate-testability-wrappers | DO NOT USE when the target already consumes an injected interface or built-in abstraction such as IFileSystem or TimeProvider, even if the request says "generate a wrapper"; no new wrapper is needed. | `${CLAUDE_PLUGIN_ROOT}/library/generate-testability-wrappers/SKILL.md` |
| grade-tests | Grade curated individual tests for readiness, A-F quality and improvements. | `${CLAUDE_PLUGIN_ROOT}/library/grade-tests/SKILL.md` |
| migrate-mstest-v1v2-to-v3 | Use this skill before answering or editing whenever an MSTest v1/v2 project is being upgraded or repaired for v3. | `${CLAUDE_PLUGIN_ROOT}/library/migrate-mstest-v1v2-to-v3/SKILL.md` |
| migrate-mstest-v3-to-v4 | Use this skill before answering, planning, or editing any MSTest 3.x-to-4.x upgrade or post-upgrade failure. | `${CLAUDE_PLUGIN_ROOT}/library/migrate-mstest-v3-to-v4/SKILL.md` |
| migrate-nunit-to-mstest | Convert .NET tests from NUnit 3/4 to MSTest v4 while preserving VSTest or MTP. | `${CLAUDE_PLUGIN_ROOT}/library/migrate-nunit-to-mstest/SKILL.md` |
| migrate-static-to-wrapper | ALWAYS USE when asked to migrate, replace, or make testable existing C# static calls with a named wrapper or built-in abstraction: DateTime.UtcNow/Now or DateTimeOffset.UtcNow to TimeProvider/IClock,… | `${CLAUDE_PLUGIN_ROOT}/library/migrate-static-to-wrapper/SKILL.md` |
| migrate-vstest-to-mtp | Use this skill before answering, planning, or editing whenever .NET tests or CI are switching from VSTest to Microsoft.Testing.Platform (MTP), or an MTP migration behaves differently. | `${CLAUDE_PLUGIN_ROOT}/library/migrate-vstest-to-mtp/SKILL.md` |
| migrate-xunit-to-mstest | Convert .NET tests from xUnit.net v2/v3 to MSTest v4 while preserving VSTest or MTP. | `${CLAUDE_PLUGIN_ROOT}/library/migrate-xunit-to-mstest/SKILL.md` |
| migrate-xunit-to-xunit-v3 | Migrate .NET test projects from xUnit.net v2 to xunit.v3 and fix v3 breaks. | `${CLAUDE_PLUGIN_ROOT}/library/migrate-xunit-to-xunit-v3/SKILL.md` |
| mtp-hot-reload | Set up or recover MTP hot reload for a long-lived console-host edit/re-run loop in a Microsoft Testing Platform project. | `${CLAUDE_PLUGIN_ROOT}/library/mtp-hot-reload/SKILL.md` |
| platform-detection | Identify a .NET project's test platform, framework, command mode, and SDK-style vs classic project system. | `${CLAUDE_PLUGIN_ROOT}/library/platform-detection/SKILL.md` |
| run-tests | ALWAYS USE before running .NET tests or answering with a test command or flags. | `${CLAUDE_PLUGIN_ROOT}/library/run-tests/SKILL.md` |
| scaffold-dotnet-test-project | MUST USE when an existing .NET test project was excluded from a .slnf/CI solution filter, disappeared from .sln/.slnx discovery, or lost its production ProjectReference; also for requests to set up,… | `${CLAUDE_PLUGIN_ROOT}/library/scaffold-dotnet-test-project/SKILL.md` |
| test-anti-patterns | Audit a test file or suite; produce a severity-ranked diagnostic report. | `${CLAUDE_PLUGIN_ROOT}/library/test-anti-patterns/SKILL.md` |
| test-gap-analysis | Find caller-visible production changes existing tests would miss through pseudo-mutation analysis; verify candidates or close gaps only when requested. | `${CLAUDE_PLUGIN_ROOT}/library/test-gap-analysis/SKILL.md` |
| test-smell-detection | Audits existing tests in any language using formal, research-backed test smell names and the testsmells.org 19-smell academic taxonomy. | `${CLAUDE_PLUGIN_ROOT}/library/test-smell-detection/SKILL.md` |
| test-tagging | Classifies existing tests by standard traits and reports their distribution. | `${CLAUDE_PLUGIN_ROOT}/library/test-tagging/SKILL.md` |
| test-value-evidence | Assess tests for an identified code or test change, feature, PR or commit. | `${CLAUDE_PLUGIN_ROOT}/library/test-value-evidence/SKILL.md` |
| testability-obstacle | MUST USE for C#/.NET deterministic tests that require the smallest production seam for DateTime/Task.Delay/File/Environment/Guid/Random, static API preservation, nested/parallel overrides, or no real… | `${CLAUDE_PLUGIN_ROOT}/library/testability-obstacle/SKILL.md` |
| writing-mstest-tests | ALWAYS USE when asked to fix, rewrite, update, improve, modernize, show corrected code for, or explain existing MSTest tests or MSTest-specific configuration. | `${CLAUDE_PLUGIN_ROOT}/library/writing-mstest-tests/SKILL.md` |
