// A line diff of two texts: removed and added lines marked, long unchanged runs folded into a quiet row. Text only.

const CONTEXT = 3;
// Past this many cells the middle shows as removed, then added, instead of a line-by-line match.
const MAX_CELLS = 4_000_000;

/** @typedef {{ op: ' ' | '-' | '+', text: string }} Line */

/** @param {string} text */
const lines = (text) => {
  if (!text) return [];
  const all = text.replace(/\r\n/g, '\n').split('\n');
  if (all.at(-1) === '') all.pop();
  return all;
};

/** The lines of `a` and `b` in order, each kept, removed or added. @param {string[]} a @param {string[]} b */
function compare(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  /** @type {Line[]} */
  const out = a.slice(0, start).map((text) => ({ op: ' ', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > MAX_CELLS) {
    out.push(...midA.map((text) => ({ op: /** @type {const} */ ('-'), text })));
    out.push(...midB.map((text) => ({ op: /** @type {const} */ ('+'), text })));
  } else {
    // The longest common subsequence, filled from the end so the walk below goes forwards.
    const width = midB.length + 1;
    const table = new Uint32Array((midA.length + 1) * width);
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        table[i * width + j] =
          midA[i] === midB[j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
        out.push({ op: ' ', text: midA[i++] });
        j++;
      } else if (i < midA.length && (j === midB.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
        // Removed before added where both keep the match as long.
        out.push({ op: '-', text: midA[i++] });
      } else {
        out.push({ op: '+', text: midB[j++] });
      }
    }
  }
  out.push(...a.slice(endA).map((text) => ({ op: /** @type {const} */ (' '), text })));
  return out;
}

const CLASS = { ' ': 'same', '-': 'del', '+': 'add' };

/** @param {Line} line */
function row(line) {
  const span = document.createElement('span');
  span.className = `ln ${CLASS[line.op]}`;
  span.textContent = `${line.op} ${line.text}\n`;
  return span;
}

/** @param {Line[]} run */
function fold(run) {
  const details = document.createElement('details');
  details.className = 'unfold';
  const summary = document.createElement('summary');
  summary.textContent = `${run.length} unchanged lines`;
  const body = document.createElement('div');
  body.className = 'unfold-body';
  body.append(...run.map(row));
  details.append(summary, body);
  return details;
}

/** @param {string} old @param {string} next @returns {HTMLElement} */
export function diff(old, next) {
  const box = document.createElement('div');
  box.className = 'diff';
  const all = compare(lines(old), lines(next));
  if (all.every((line) => line.op === ' ')) {
    const same = document.createElement('p');
    same.className = 'quiet';
    same.textContent = 'No change.';
    box.append(same);
    return box;
  }
  for (let i = 0; i < all.length;) {
    if (all[i].op !== ' ') {
      box.append(row(all[i++]));
      continue;
    }
    let end = i;
    while (end < all.length && all[end].op === ' ') end++;
    const run = all.slice(i, end);
    // Context stays beside a change; the rest of the run folds.
    const before = i === 0 ? 0 : CONTEXT;
    const after = end === all.length ? 0 : CONTEXT;
    if (run.length > before + after + 1) {
      box.append(...run.slice(0, before).map(row), fold(run.slice(before, run.length - after)));
      box.append(...run.slice(run.length - after).map(row));
    } else {
      box.append(...run.map(row));
    }
    i = end;
  }
  return box;
}
