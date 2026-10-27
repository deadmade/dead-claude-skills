---
name: binlog-failure-analysis
description: "Analyze MSBuild binary logs to diagnose build failures. USE FOR: build errors that are unclear from console output, diagnosing cascading failures across multi-project builds, tracing MSBuild target execution order, and generally any MSBuild build issues. Requires an existing .binlog file. DO NOT USE FOR: generating binlogs (use binlog-generation), non-MSBuild build systems."
license: MIT
---

# Analyzing MSBuild Failures with Binary Logs

This skill diagnoses MSBuild build failures from a `.binlog` file by replaying it to text logs.

## Text-log replay

### Replay the binlog to text logs

```bash
dotnet msbuild build.binlog -noconlog \
  -fl  "-flp:v=diag;logfile=full.log;performancesummary" \
  -fl1 "-flp1:errorsonly;logfile=errors.log" \
  -fl2 "-flp2:warningsonly;logfile=warnings.log"
```

> **PowerShell note:** Use `-flp:"v=diag;logfile=full.log;performancesummary"`
> (quoted semicolons).

### Search the text logs

```bash
cat errors.log
grep -n -B2 -A2 "CS0246" full.log
grep -i "CoreCompile.*FAILED\|Build FAILED\|error MSB" full.log
grep 'Target "CoreCompile"' full.log | grep -oP 'project "[^"]*"'
```

## Generating a binlog (only if none exists)

```bash
dotnet build /bl:build.binlog
```
