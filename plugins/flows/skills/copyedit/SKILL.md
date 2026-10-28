---
name: copyedit
description: "Copyedit a Markdown document by the method of Williams and Bizup's Style: an Opus editor revises it for a reader who was not in the conversation, code checks that no heading, code, link, number, checkbox step or table row was lost, and only then the document is replaced. Commits nothing. Use for /copyedit <file.md>; the flows run it before a gate shows a spec, a plan or an audit report."
disable-model-invocation: true
argument-hint: '<file.md>'
---

# copyedit

A document written during a conversation reads well to the people who were there. This skill has a fresh editor,
who wasn't, revise it by the book, and lets the edit through only when code shows that nothing the document says was
lost. It commits nothing, so it works the same on any branch and inside the other flows.

Other conductors run it by reading this file. Its paths go through `"${CLAUDE_SKILL_DIR}/../copyedit/"`, so they
resolve from whichever skill read it.

## 1. Save the document

The run folder is `copyedit/<name>/` in the session's scratchpad (a temporary folder outside the repo when there is
none), where `<name>` is the document's parent folder and file name, for example `writing-style-spec`. Empty it
first, so nothing from an earlier run is mistaken for this one's, then save the document's current version:

```bash
rm -rf "<run folder>" && mkdir -p "<run folder>" && cp "<document>" "<run folder>/saved.md"
```

## 2. Measure

Code lists the candidate problems the editor should judge first: wordy phrases, redundant pairs and negatives from
`data/phrases.tsv`, and, when the installer's prose environment (spaCy) exists, the eight kinds `scripts/measure.py`
finds. Run it with the Bash tool's timeout at 600000 ms:

```bash
node "${CLAUDE_SKILL_DIR}/../copyedit/scripts/measure.mjs" "<document>" "<run folder>/before/"
```

It writes `before/candidates.txt` and `before/totals.json`. When spaCy's measures didn't run, it prints one line
saying so and why; show that line. The phrase candidates are in the file either way.

## 3. Edit

Start one fresh agent with the Agent tool: `subagent_type: "general-purpose"`, `model: "opus"`. Its prompt is exactly
the text below, with `<doc>` the document's absolute path, `<guide>` the absolute path of
`"${CLAUDE_SKILL_DIR}/../copyedit/references/edit.md"`, `<candidates>` the absolute path of
`<run folder>/before/candidates.txt` and `<out>` the absolute path of `<run folder>/edited.txt`. Include the
bracketed paragraph, without its brackets, only when the candidates file lists at least one candidate.

```
You are a copy editor. Edit the Markdown document <doc> so it reads clearly to a smart reader who was not in the conversation that produced it.

Edit by the method in <guide>: run its diagnoses on every sentence and paragraph, then revise where a diagnosis shows a problem and the change helps the reader.

[Code has measured the document against the book and listed candidate problems by line in <candidates> (code spans appear as "X"). Judge each candidate by the book: fix it when the fix helps the reader, leave it when it doesn't (many passives and long openers are fine). The list is a starting point, not a limit: diagnose the sentences it doesn't name too.]

Keep every fact, decision, number, name, date, version, quote, code span, code block, link and link target: nothing the document says may be lost or change meaning. Keep every heading and the order of sections. Keep every checkbox step, numbered item and table as it is (rows, columns and order); edit only the prose inside them. Elsewhere in a section you may rewrite, reorder, merge or split sentences, and turn prose into a list or a list into prose. Don't add content the original doesn't support, and don't add a summary, an introduction or a conclusion it lacks. Leave conversation labels (question numbers, round numbers, decision IDs) as they are: you weren't there, so you can't know what they meant.

Read only the files named here. Write the whole edited document to <out> and write nothing else anywhere. Then reply with one line starting "Removed:" that lists anything you removed rather than reworded, or "Removed: nothing".
```

The editor writes a `.txt` file because subagents may not be allowed to write Markdown files.

## 4. Check and show

```bash
node "${CLAUDE_SKILL_DIR}/../copyedit/scripts/compare.mjs" "<run folder>/saved.md" "<run folder>/edited.txt" "<document>"
```

- **Exit 1:** it printed what the edit lost, one item per line. Show those lines and stop. The document is unchanged.
- **Exit 2:** it failed for another reason and printed it. Show that line and stop. The document is unchanged.
- **Exit 0:** it copied the edit over the document, in the document's own line endings, and printed the write-time
  check's findings that the saved version didn't have. Show:
  - the diff: `git diff --no-index "<run folder>/saved.md" "<document>"` (it exits 1 when the files differ, which is
    expected);
  - the editor's `Removed:` line;
  - the new findings, if any, for whoever owns the document to fix;
  - the measures before and after: run step 2's command again, with the same timeout and `"<run folder>/after/"` as its last argument,
    show its skip line if it printed one, and show `before/totals.json` and `after/totals.json` as one table, a row
    per figure with its before and after values.

Don't commit. Whoever ran `/copyedit` decides what to keep; the saved copy stays in the run folder until the next run
on the same document.
