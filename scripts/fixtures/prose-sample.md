---
title: Prose sample
---

# Prose sample

Sentences for `measure.py`: after each marker, the next line holds a sentence with that kind of candidate.

<!-- expect: nominalization -->

The team will make a decision about the release next week.

<!-- expect: passive -->

The cache files were fetched before the second run started.

<!-- expect: abstract subject -->

There are three reasons for the delay in the schedule.

<!-- expect: no link to the previous sentence -->

The installer downloads the model from GitHub. Rain fell on the old harbour all night.

<!-- expect: long opener -->

When the download finishes and the hash matches the pinned value in the lock file, the installer writes the marker.

<!-- expect: long subject -->

The small script that reads the masked text from standard input on every run exits early.

<!-- expect: subject-verb gap -->

The installer, after it has checked the hash of every file in the lock, writes the marker.

<!-- expect: list in a sentence -->

The installer checks Python, spaCy, PyTorch, the model and the cache before it starts.

```text
The files were deleted by the old job and were never restored. There are many reasons for the
delay, and the installer, after it has checked every file in the lock, writes the marker.
```

- The list item checks Python, spaCy, PyTorch, the model and the cache before it starts.

  Its second paragraph checks Python, spaCy, PyTorch, the model and the cache again.

- Another item follows it.

| Step  | What happens                                     |
| ----- | ------------------------------------------------ |
| Check | The hash of each file is compared with the lock. |
