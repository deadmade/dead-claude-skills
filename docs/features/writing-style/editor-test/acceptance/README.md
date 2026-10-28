# Acceptance runs

Spec success criteria 3–5, run 2026-10-28 with the shipped pieces. The procedure is the editor test's
([../README.md](../README.md)), with three versions per section: the original at `8281c59`, the stored `plain` version
and `/copyedit`'s.

- `versions/`: `/copyedit`'s edits of `spec.md` and `findings.md`, made by an Opus editor with the shipped prompt,
  guide (`references/edit.md`) and candidates (`results/<doc>.candidates.txt`, from `measure.mjs` with the spaCy
  environment). `results/`: the blind rankings (`rank.<doc>.<judge>.jsonl`, decoded by `<doc>.key.json`), the fact
  checks (empty: no claim changed or lost) and the measures before and after.
- `variant/`: the same run with a revised guide (`variant/edit.md`: a "Whole sentences first" diagnosis, and "don't
  guess" narrowed to meaning). Its rankings have four versions per section: original, plain, shipped, variant.
- `criterion5/`: a `claude -p` session told to write a spec with "grill Q3" and "D2" labels and to revise after hook
  feedback: the check's one report (`hook-responses.json`) and the spec it ended with.
- `labels/`: the variant guide plus a label rule (state what a conversation label stands for when the document itself
  says it), in the guide (`labels/edit.md`) and the prompt's last clause. Fresh judges ranked four versions per
  section: original, plain, the variant's edit from `variant/` (the same text) and this one's.
