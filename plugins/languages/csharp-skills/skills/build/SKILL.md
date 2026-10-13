---
name: build
description: "C#/.NET only. MSBuild and build failures, NuGet packages and central package management, upgrading .NET versions, dotnet new templates. Index of Microsoft's .NET skills for these."
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

# C#/.NET skills: build

Microsoft's .NET skills for this area (vendored from dotnet/skills). Pick the one that matches the task, read its
SKILL.md with the Read tool, and follow it. When a skill names another skill, read
`${CLAUDE_PLUGIN_ROOT}/library/<that-name>/SKILL.md`.

| Skill | Use for | Path |
| --- | --- | --- |
| binlog-failure-analysis | Analyze MSBuild binary logs to diagnose build failures. | `${CLAUDE_PLUGIN_ROOT}/library/binlog-failure-analysis/SKILL.md` |
| binlog-generation | Generate MSBuild binary logs (binlogs) for build diagnostics and analysis. | `${CLAUDE_PLUGIN_ROOT}/library/binlog-generation/SKILL.md` |
| build-parallelism | Analyze an MSBuild solution, solution filter, or Build.proj that schedules multiple project files. | `${CLAUDE_PLUGIN_ROOT}/library/build-parallelism/SKILL.md` |
| build-perf-baseline | Establish MSBuild/.NET build performance baselines before optimizing. | `${CLAUDE_PLUGIN_ROOT}/library/build-perf-baseline/SKILL.md` |
| build-perf-diagnostics | Diagnose MSBuild build performance bottlenecks using binary log analysis. | `${CLAUDE_PLUGIN_ROOT}/library/build-perf-diagnostics/SKILL.md` |
| check-bin-obj-clash | Detects MSBuild projects with conflicting OutputPath or IntermediateOutputPath. | `${CLAUDE_PLUGIN_ROOT}/library/check-bin-obj-clash/SKILL.md` |
| convert-to-cpm | Convert .NET projects and solutions (.sln, .slnx) to NuGet Central Package Management (CPM) using Directory.Packages.props. | `${CLAUDE_PLUGIN_ROOT}/library/convert-to-cpm/SKILL.md` |
| copy-to-output-directory | Choosing an MSBuild CopyToOutputDirectory / CopyToPublishDirectory mode: Never, PreserveNewest, Always, and IfDifferent (MSBuild 17.13+), plus $(SkipUnchangedFilesOnCopyAlways). | `${CLAUDE_PLUGIN_ROOT}/library/copy-to-output-directory/SKILL.md` |
| directory-build-organization | USE ONLY for (1) two or more projects with repeated MSBuild policy, targets, or package versions, or (2) an existing Directory.Build.props/targets/rsp hierarchy with an import, placement, or layering… | `${CLAUDE_PLUGIN_ROOT}/library/directory-build-organization/SKILL.md` |
| dotnet-aot-compat | Make .NET projects compatible with Native AOT and trimming by systematically resolving IL trim/AOT analyzer warnings. | `${CLAUDE_PLUGIN_ROOT}/library/dotnet-aot-compat/SKILL.md` |
| eval-performance | Guide for diagnosing and improving MSBuild project evaluation performance. | `${CLAUDE_PLUGIN_ROOT}/library/eval-performance/SKILL.md` |
| extension-points | Own MSBuild import and hook discovery. | `${CLAUDE_PLUGIN_ROOT}/library/extension-points/SKILL.md` |
| including-generated-files | Own MSBuild generated-artifact integration. | `${CLAUDE_PLUGIN_ROOT}/library/including-generated-files/SKILL.md` |
| incremental-build | Guide for optimizing MSBuild incremental builds. | `${CLAUDE_PLUGIN_ROOT}/library/incremental-build/SKILL.md` |
| item-management | Own concrete MSBuild ItemGroup and item-expression questions. | `${CLAUDE_PLUGIN_ROOT}/library/item-management/SKILL.md` |
| migrate-dotnet10-to-dotnet11 | Migrate a .NET 10 project or solution to .NET 11 and resolve all breaking changes. | `${CLAUDE_PLUGIN_ROOT}/library/migrate-dotnet10-to-dotnet11/SKILL.md` |
| migrate-dotnet8-to-dotnet9 | Migrate a .NET 8 project to .NET 9 and resolve all breaking changes. | `${CLAUDE_PLUGIN_ROOT}/library/migrate-dotnet8-to-dotnet9/SKILL.md` |
| migrate-dotnet9-to-dotnet10 | Migrate a .NET 9 project or solution to .NET 10 and resolve all breaking changes. | `${CLAUDE_PLUGIN_ROOT}/library/migrate-dotnet9-to-dotnet10/SKILL.md` |
| migrate-nullable-references | Enable nullable reference types in a C# project and systematically resolve all warnings. | `${CLAUDE_PLUGIN_ROOT}/library/migrate-nullable-references/SKILL.md` |
| msbuild-antipatterns | DO NOT INVOKE when the primary request explicitly asks to convert, migrate, modernize, or rewrite a legacy/old-style project to SDK style; use msbuild-modernization. | `${CLAUDE_PLUGIN_ROOT}/library/msbuild-antipatterns/SKILL.md` |
| msbuild-modernization | Guide for modernizing and migrating MSBuild project files to SDK-style format. | `${CLAUDE_PLUGIN_ROOT}/library/msbuild-modernization/SKILL.md` |
| property-patterns | Diagnose and fix concrete MSBuild property defects in projects and existing shared-file hierarchies. | `${CLAUDE_PLUGIN_ROOT}/library/property-patterns/SKILL.md` |
| resolve-project-references | Guide for interpreting ResolveProjectReferences time in MSBuild performance summaries. | `${CLAUDE_PLUGIN_ROOT}/library/resolve-project-references/SKILL.md` |
| target-authoring | Canonical patterns for writing custom MSBuild targets. | `${CLAUDE_PLUGIN_ROOT}/library/target-authoring/SKILL.md` |
| template-authoring | Guides creation and validation of custom dotnet new templates from existing projects. | `${CLAUDE_PLUGIN_ROOT}/library/template-authoring/SKILL.md` |
| template-comparison | Compares two or more dotnet new templates side by side to help users choose between them based on parameters, feature support, frameworks, and classifications. | `${CLAUDE_PLUGIN_ROOT}/library/template-comparison/SKILL.md` |
| template-discovery | Helps find, inspect, and compare (at a high level) .NET project templates. | `${CLAUDE_PLUGIN_ROOT}/library/template-discovery/SKILL.md` |
| template-instantiation | Creates .NET projects from templates with validated parameters, smart defaults, Central Package Management adaptation, and latest NuGet version resolution. | `${CLAUDE_PLUGIN_ROOT}/library/template-instantiation/SKILL.md` |
| template-smart-defaults | Applies cross-parameter default rules when creating .NET projects with dotnet new, filling gaps consistently without overriding values the user set explicitly. | `${CLAUDE_PLUGIN_ROOT}/library/template-smart-defaults/SKILL.md` |
| template-validation | Validates custom dotnet new templates for correctness before publishing. | `${CLAUDE_PLUGIN_ROOT}/library/template-validation/SKILL.md` |
| thread-abort-migration | Guides migration of .NET Framework Thread.Abort usage to cooperative cancellation in modern .NET. | `${CLAUDE_PLUGIN_ROOT}/library/thread-abort-migration/SKILL.md` |
