---
name: core
description: "C#/.NET only. C# language semantics and refactoring, runtime diagnostics and performance, .NET 11 APIs, advanced scenarios, AI/LLM integration in .NET. Index of Microsoft's .NET skills for these."
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

# C#/.NET skills: core

Microsoft's .NET skills for this area (vendored from dotnet/skills). Pick the one that matches the task, read its
SKILL.md with the Read tool, and follow it. When a skill names another skill, read
`${CLAUDE_PLUGIN_ROOT}/library/<that-name>/SKILL.md`.

| Skill | Use for | Path |
| --- | --- | --- |
| analyzing-dotnet-performance | Scans .NET code for ~50 performance anti-patterns across async, memory, strings, collections, LINQ, regex, serialization, and I/O with tiered severity classification. | `${CLAUDE_PLUGIN_ROOT}/library/analyzing-dotnet-performance/SKILL.md` |
| android-tombstone-symbolication | Symbolicate the .NET runtime frames in an Android tombstone file. | `${CLAUDE_PLUGIN_ROOT}/library/android-tombstone-symbolication/SKILL.md` |
| apple-crash-symbolication | Symbolicate .NET runtime frames in Apple platform .ips crash logs (iOS, tvOS, Mac Catalyst, macOS). | `${CLAUDE_PLUGIN_ROOT}/library/apple-crash-symbolication/SKILL.md` |
| clr-activation-debugging | Diagnoses .NET Framework CLR activation issues using CLR activation logs (CLRLoad logs) produced by mscoree.dll. | `${CLAUDE_PLUGIN_ROOT}/library/clr-activation-debugging/SKILL.md` |
| csharp-expert | Route C# and .NET requests to the exact installed specialist or smallest dotnet/skills marketplace plugin. | `${CLAUDE_PLUGIN_ROOT}/library/csharp-expert/SKILL.md` |
| csharp-refactoring | Safely refactors C#/.NET code without changing behavior. | `${CLAUDE_PLUGIN_ROOT}/library/csharp-refactoring/SKILL.md` |
| csharp-scripts | Run file-based C# apps with the .NET CLI when the user explicitly wants C#/.NET code without creating a project. | `${CLAUDE_PLUGIN_ROOT}/library/csharp-scripts/SKILL.md` |
| dotnet-pinvoke | Correctly call native (C/C++) libraries from .NET using P/Invoke and LibraryImport. | `${CLAUDE_PLUGIN_ROOT}/library/dotnet-pinvoke/SKILL.md` |
| dotnet-trace-collect | Guide developers through capturing diagnostic artifacts to diagnose production .NET performance issues. | `${CLAUDE_PLUGIN_ROOT}/library/dotnet-trace-collect/SKILL.md` |
| dump-collect | Configure and collect crash dumps for modern .NET applications. | `${CLAUDE_PLUGIN_ROOT}/library/dump-collect/SKILL.md` |
| microbenchmarking | Activate this skill when BenchmarkDotNet (BDN) is involved in the task — creating, running, configuring, or reviewing BDN benchmarks. | `${CLAUDE_PLUGIN_ROOT}/library/microbenchmarking/SKILL.md` |
| msbuild | Use only for MSBuild failure investigation, build-performance analysis, or review of existing build XML/extension contracts. | `${CLAUDE_PLUGIN_ROOT}/library/msbuild/SKILL.md` |
| nuget-trusted-publishing | Set up NuGet trusted publishing (OIDC) on a GitHub Actions repo — replaces long-lived API keys with short-lived tokens. | `${CLAUDE_PLUGIN_ROOT}/library/nuget-trusted-publishing/SKILL.md` |
| process-api-net11 | Provides guidance on the new System.Diagnostics.Process APIs introduced in .NET 11: Process.Run, Process.RunAndCaptureText, Process.StartAndForget, Process.ReadAllText/Bytes/Lines, KillOnParentExit,… | `${CLAUDE_PLUGIN_ROOT}/library/process-api-net11/SKILL.md` |
| setup-local-sdk | Install a .NET SDK locally for safe preview testing, specific-version pinning, or reproducible team setups — without modifying the system-wide installation. | `${CLAUDE_PLUGIN_ROOT}/library/setup-local-sdk/SKILL.md` |
| system-text-json-net11 | Imperative guidance for the System.Text.Json APIs added in .NET 11: the built-in `JsonNamingPolicy.PascalCase` naming policy, and the strongly-typed generic `JsonSerializerOptions.GetTypeInfo` and… | `${CLAUDE_PLUGIN_ROOT}/library/system-text-json-net11/SKILL.md` |
| technology-selection | Guides technology selection and implementation of AI and ML features in .NET 8+ applications using ML.NET, Microsoft.Extensions.AI (MEAI), Microsoft Agent Framework (MAF), GitHub Copilot SDK, ONNX… | `${CLAUDE_PLUGIN_ROOT}/library/technology-selection/SKILL.md` |
| vectorization | Design, implement, optimize, and review SIMD code in .NET. | `${CLAUDE_PLUGIN_ROOT}/library/vectorization/SKILL.md` |
