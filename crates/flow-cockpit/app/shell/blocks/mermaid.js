// A Mermaid diagram from its source. Mermaid is the vendored classic script (`window.mermaid`), set up once with
// `securityLevel: 'strict'`, which sanitises every label and turns off click handlers in diagrams. Until it draws, and
// when it can't, the source shows as text with the reason under it.

/**
 * @typedef {{
 *   initialize(config: Record<string, unknown>): void,
 *   render(id: string, source: string): Promise<{ svg: string }>,
 * }} Mermaid
 */

let ready = false;
let next = 0;
// The SVG of each source drawn lately, so a redraw shows a diagram at once instead of flashing back to its source.
/** @type {Map<string, string>} */
const drawn = new Map();
const KEEP = 64;

/** @param {string} name */
const token = (name) => window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** @param {Mermaid} lib */
function setUp(lib) {
  if (ready) return;
  lib.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    // Mermaid 12's default "neo" look gives every node a 120px minimum; the classic look sizes nodes to their label.
    look: 'classic',
    htmlLabels: false,
    flowchart: { useMaxWidth: false, minNodeWidth: 0, rankSpacing: 26, nodeSpacing: 14, padding: 9, curve: 'basis' },
    themeVariables: {
      darkMode: true,
      background: token('--color-paper'),
      fontFamily: token('--font-body'),
      fontSize: '13px',
      primaryColor: token('--color-paper-3'),
      primaryTextColor: token('--color-ink'),
      primaryBorderColor: token('--color-paper-4'),
      lineColor: token('--color-paper-4'),
      secondaryColor: token('--color-paper-2'),
      tertiaryColor: token('--color-paper-2'),
    },
  });
  ready = true;
}

/** @param {string} source @returns {HTMLElement} */
export function mermaid(source) {
  const box = document.createElement('div');
  box.className = 'diagram';
  const svg = drawn.get(source);
  if (svg !== undefined) {
    // Mermaid's own SVG, as in `draw`.
    box.innerHTML = svg;
    return box;
  }
  const code = document.createElement('pre');
  code.textContent = source;
  box.append(code);
  draw(box, source);
  return box;
}

/** @param {HTMLElement} box @param {string} source */
async function draw(box, source) {
  const lib = /** @type {Mermaid | undefined} */ (/** @type {any} */ (window).mermaid);
  try {
    if (!lib) throw new Error('Mermaid did not load.');
    setUp(lib);
    const { svg } = await lib.render(`diagram-${++next}`, source);
    // Mermaid's own SVG: under strict security it runs DOMPurify over the whole SVG before returning it, and the
    // window's CSP blocks inline handlers besides.
    box.innerHTML = svg;
    drawn.delete(source);
    drawn.set(source, svg);
    if (drawn.size > KEEP) drawn.delete(/** @type {string} */ (drawn.keys().next().value));
  } catch (err) {
    const note = document.createElement('p');
    note.className = 'quiet';
    note.textContent = `This diagram couldn't be drawn: ${err instanceof Error ? err.message : String(err)}`;
    box.append(note);
  }
}
