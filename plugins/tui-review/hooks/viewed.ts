// "Viewed" marks, kept across sessions in $.store under one key, by each file's new blob id: a file whose content a
// rebase leaves alone keeps its mark, and one that changed comes back unviewed. Plain data: the hooks module does the
// $.store calls.

export const VIEWED_KEY = 'viewed';
/** Marks older than this are dropped on the next write, and at most MAX are kept, so the store stays small. */
const KEEP_DAYS = 90;
const MAX = 40_000;

const today = () => Math.floor(Date.now() / 86_400_000);

export class Viewed {
  private constructor(private readonly marks: Map<string, number>) {}

  /** From what `$.store.get(VIEWED_KEY)` gave back; anything malformed counts as no marks. */
  static from(stored: unknown): Viewed {
    const entries =
      typeof stored === 'object' && stored !== null
        ? Object.entries(stored).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
        : [];
    return new Viewed(new Map(entries));
  }

  has(blob: string): boolean {
    return this.marks.has(blob);
  }

  /** Flips the mark; returns whether the file is viewed now. Save with `stored()` afterwards. */
  toggle(blob: string): boolean {
    const isViewed = !this.marks.delete(blob);
    if (isViewed) this.marks.set(blob, today());
    const oldest = today() - KEEP_DAYS;
    for (const [key, day] of this.marks) if (day < oldest) this.marks.delete(key);
    // Insertion order is age order (a re-mark is a new entry), so the first keys are the oldest.
    for (const key of this.marks.keys()) {
      if (this.marks.size <= MAX) break;
      this.marks.delete(key);
    }
    return isViewed;
  }

  /** What to `$.store.set(VIEWED_KEY, …)`. */
  stored(): Record<string, number> {
    return Object.fromEntries(this.marks);
  }
}
