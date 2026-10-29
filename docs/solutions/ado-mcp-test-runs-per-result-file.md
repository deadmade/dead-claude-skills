# ado-mcp: pipeline_view says tests passed while some test runs failed

- **Seen:** 2026-10-29, the final review of feature ado-mcp-next. `pipeline_view` summed only the newest test run per
  run name, to skip a retried job's old attempt.
- **Cause:** PublishTestResults defaults to `mergeTestResults: false`, so it publishes one test run per result file,
  all named alike (one per `TEST-*.xml` under Maven or Gradle). Several jobs that use the default title share a name
  too. So "newest per name" dropped real runs and their failures. A retry is told apart only by the run's
  `pipelineReference`: stage, phase and job names, each with an attempt.
- **Fix:** `latest_attempts` (`crates/ado-mcp/src/pipeline.rs:404`, key from `job_attempt` at `:377`) keeps every run of a
  job's highest (stage, phase, job) attempt, and every run without a usable reference. Commit 50bf5a4; spec goal 3 in
  `docs/features/ado-mcp-next/spec.md`.
- **Spot it next time:** a run name is not an identity. Ask what publishes several runs per job before
  de-duplicating. The Server 7.1 Runs - List sample has no `pipelineReference`, so the smoke checklist
  (`docs/features/ado-mcp/smoke.md`) asks for a live run's reference keys.
