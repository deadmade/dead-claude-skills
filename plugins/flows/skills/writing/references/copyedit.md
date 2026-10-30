# Copyedit a document

A document written during a conversation reads well to the people who were there. This procedure has a fresh editor,
who wasn't, revise it, and lets the edit through only when code shows that nothing the document says was lost. It
commits nothing, so it works the same on any branch and inside the other flows.

The `writing` skill runs it when asked to copyedit a file (`/flows:writing copyedit <file.md>`), and the flows run it
by reading this file before a gate. Its paths go through `"${CLAUDE_SKILL_DIR}/../writing/"`, so they resolve from
whichever skill read it.

## 1. Save the document

The run folder is `copyedit/<name>/` in the session's scratchpad (a temporary folder outside the repo when there is
none), where `<name>` is the document's parent folder and file name, for example `writing-style-spec`. Empty it
first, so nothing from an earlier run is mistaken for this one's, then save the document's current version:

```bash
rm -rf "<run folder>" && mkdir -p "<run folder>" && cp "<document>" "<run folder>/saved.md"
```

## 2. Edit

Start one fresh agent with the Agent tool: `subagent_type: "general-purpose"`, `model: "opus"`. Its prompt is exactly
the text below, with `<doc>` the document's absolute path, `<standard>` the absolute path of
`"${CLAUDE_SKILL_DIR}/../writing/SKILL.md"` and `<out>` the absolute path of `<run folder>/edited.txt`.

```
You are a copy editor. Edit the Markdown document <doc> so it reads clearly to a smart reader who was not in the conversation that produced it.

The standard is <standard>. Revise where it shows a problem and the change helps the reader.

Keep every fact, decision, number, name, date, version, quote, code span, code block, link, URL, HTML comment and link target: nothing the document says may be lost or change meaning, and no requirement may flip (a "must not" stays a "must not"). Keep every heading and the order of sections. Keep every checkbox step, numbered item and table as it is (rows, columns and order); edit only the prose inside them. Elsewhere in a section you may rewrite, reorder, merge or split sentences, and turn prose into a list or a list into prose. Don't add content the original doesn't support, and don't add a summary, an introduction or a conclusion it lacks. Leave conversation labels (question numbers, round numbers, decision IDs) as they are unless the document itself says what they stand for: you weren't there.

Read only the files named here. Write the whole edited document to <out> and write nothing else anywhere. Then reply with one line starting "Removed:" that lists anything you removed rather than reworded, or "Removed: nothing".
```

The editor writes a `.txt` file because subagents may not be allowed to write Markdown files.

## 3. Check and show

```bash
node "${CLAUDE_SKILL_DIR}/../writing/scripts/compare.mjs" "<run folder>/saved.md" "<run folder>/edited.txt" "<document>"
```

- **Exit 1:** it printed what the edit lost, one item per line, or that the document changed since step 1 saved it.
  Show those lines and stop. The document is unchanged.
- **Exit 2:** it failed for another reason and printed it. Show that line and stop. The document is unchanged.
- **Exit 0:** it copied the edit over the document, in the document's own line endings, and printed the prose
  check's findings that the saved version didn't have. Show:
  - the diff: `git diff --no-index "<run folder>/saved.md" "<document>"` (it exits 1 when the files differ, which is
    expected);
  - the editor's `Removed:` line;
  - the new findings, if any, for whoever owns the document to fix.

`compare.mjs` checks what code can see: headings, code, links, URLs, comments, numbers, checkbox steps, table shapes,
quotes, and that at least 60% of the prose words remain. It can't see meaning: a dropped sentence without a number in
it, or a negation that flipped, passes. Read the diff before you accept the edit.

Don't commit. Whoever asked for the copyedit decides what to keep; the saved copy stays in the run folder until the next run
on the same document.
