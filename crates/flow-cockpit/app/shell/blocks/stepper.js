// The phase track from the approved run view: one line of segments with a tick for each gate, the current phase
// named under it, and the full list of phases and gates on demand.

let next = 0;

/** `2026-10-28` as `28 Oct`; anything else as written. @param {string} iso */
const day = (iso) => {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/** @param {string[]} items */
const joined = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** @param {string} tag @param {string} className @param {string} [text] */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {{ n: number, approved: string | null }[]} gates */
function gateLine(gates) {
  const open = gates.filter((g) => !g.approved);
  if (open.length) {
    const names = joined(open.map((g) => `gate ${g.n}`));
    return `${names.charAt(0).toUpperCase()}${names.slice(1)} ${open.length === 1 ? 'is' : 'are'} open.`;
  }
  const dates = [...new Set(gates.map((g) => g.approved))];
  const all = gates.length === 1 ? 'The gate' : gates.length === 2 ? 'Both gates' : `All ${gates.length} gates`;
  return `${all} passed${dates.length === 1 && dates[0] ? ` ${day(dates[0])}` : ''}.`;
}

const STATE = { Done: 'done', Now: 'current', Later: '' };
const MARK = { Done: 'Done', Now: 'Now', Later: '' };

/** @param {import('../api').Step[]} steps @returns {HTMLElement} */
export function stepper(steps) {
  const box = el('div', 'stepper');
  if (!steps.length) {
    box.append(el('p', 'track-text', 'No phases written yet.'));
    return box;
  }
  const id = `phases-${++next}`;
  const track = /** @type {HTMLButtonElement} */ (el('button', 'track'));
  track.type = 'button';
  track.setAttribute('aria-expanded', 'false');
  track.setAttribute('aria-controls', id);
  const segs = el('span', 'segs');
  segs.setAttribute('aria-hidden', 'true');
  const list = el('ol', 'rows phase-list');
  list.id = id;
  list.hidden = true;
  steps.forEach((step, i) => {
    segs.append(el('span', `seg ${STATE[step.state]}`.trim()));
    const phase = el('li', `row phase ${STATE[step.state]}`.trim());
    if (step.state === 'Now') phase.setAttribute('aria-current', 'step');
    phase.append(
      el('span', 'k num', String(i + 1)),
      el('span', 'ttl', step.label),
      el('span', 'mark', MARK[step.state]),
    );
    list.append(phase);
    if (step.gate) {
      const { n, approved } = step.gate;
      segs.append(el('span', approved ? 'tick passed' : 'tick'));
      const gate = el('li', `row gate ${approved ? 'passed' : 'open'}`);
      gate.append(
        el('span', 'k num', `G${n}`),
        el('span', 'ttl', `Gate ${n}`),
        el('span', 'mark', approved ? `Passed ${day(approved)}` : 'Open'),
      );
      list.append(gate);
    }
  });
  const now = steps.findIndex((s) => s.state === 'Now');
  const where = el('span', 'track-text');
  if (now >= 0) where.append(el('b', '', steps[now].label), `, phase ${now + 1} of ${steps.length}.`);
  else if (steps.every((s) => s.state === 'Done')) where.textContent = 'Done, every phase passed.';
  else where.textContent = 'No phase is under way.';
  track.append(segs, where);
  track.addEventListener('click', () => {
    const open = track.getAttribute('aria-expanded') === 'true';
    track.setAttribute('aria-expanded', String(!open));
    list.hidden = open;
  });
  box.append(track);
  const gates = steps.flatMap((s) => (s.gate ? [s.gate] : []));
  if (gates.length) box.append(el('p', 'track-gates', gateLine(gates)));
  box.append(list);
  return box;
}
