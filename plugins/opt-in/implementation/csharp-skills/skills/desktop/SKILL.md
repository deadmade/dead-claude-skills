---
name: desktop
description: "C#/.NET only. .NET MAUI and Windows Forms apps: setup, layout, data binding, navigation, diagnostics. Index of Microsoft's .NET skills for these."
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

# C#/.NET skills: desktop

Microsoft's .NET skills for this area (vendored from dotnet/skills). Pick the one that matches the task, read its
SKILL.md with the Read tool, and follow it. When a skill names another skill, read
`${CLAUDE_PLUGIN_ROOT}/library/<that-name>/SKILL.md`.

| Skill | Use for | Path |
| --- | --- | --- |
| dotnet-maui-doctor | Diagnoses and fixes .NET MAUI development environment issues. | `${CLAUDE_PLUGIN_ROOT}/library/dotnet-maui-doctor/SKILL.md` |
| maui-app-lifecycle | .NET MAUI app lifecycle guidance — the four app states, cross-platform Window lifecycle events (Created, Activated, Deactivated, Stopped, Resumed, Destroying), platform-specific lifecycle mapping,… | `${CLAUDE_PLUGIN_ROOT}/library/maui-app-lifecycle/SKILL.md` |
| maui-collectionview | Guidance for implementing CollectionView in .NET MAUI apps — data display, layouts (list & grid), selection, grouping, scrolling, empty views, templates, incremental loading, swipe actions, and… | `${CLAUDE_PLUGIN_ROOT}/library/maui-collectionview/SKILL.md` |
| maui-data-binding | Guidance for .NET MAUI XAML and C# data bindings — compiled bindings, INotifyPropertyChanged / ObservableObject, value converters, binding modes, multi-binding, relative bindings, fallbacks, and MVVM… | `${CLAUDE_PLUGIN_ROOT}/library/maui-data-binding/SKILL.md` |
| maui-dependency-injection | Guidance for configuring dependency injection in .NET MAUI apps — service registration in MauiProgram.cs, lifetime selection (Singleton / Transient / Scoped), constructor injection, Shell navigation… | `${CLAUDE_PLUGIN_ROOT}/library/maui-dependency-injection/SKILL.md` |
| maui-safe-area | .NET MAUI safe area and edge-to-edge layout guidance for .NET 10+. | `${CLAUDE_PLUGIN_ROOT}/library/maui-safe-area/SKILL.md` |
| maui-shell-navigation | Guide for implementing Shell-based navigation in .NET MAUI apps. | `${CLAUDE_PLUGIN_ROOT}/library/maui-shell-navigation/SKILL.md` |
| maui-theming | Guide for theming .NET MAUI apps — light/dark mode via AppThemeBinding, ResourceDictionary theme switching, DynamicResource bindings, system theme detection, and user theme preferences. | `${CLAUDE_PLUGIN_ROOT}/library/maui-theming/SKILL.md` |
| winforms-expert | Create, modify, debug, or review Windows Forms applications only when the request contains a concrete Windows Forms marker. | `${CLAUDE_PLUGIN_ROOT}/library/winforms-expert/SKILL.md` |
