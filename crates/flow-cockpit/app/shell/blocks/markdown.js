// Untrusted text to HTML, in one place: marked, then DOMPurify on every output. Scripts, event handlers,
// `javascript:` links, forms, styles and image maps are gone before anything reaches the page, and a link never
// navigates the window. A fenced `mermaid` block becomes a diagram.
import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';
import { mermaid } from './mermaid.js';

const POLICY = { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ['style', 'form', 'map', 'area'], FORBID_ATTR: ['style'] };

/** @param {string} text @returns {HTMLElement} */
export function markdown(text) {
  const html = marked.parse(String(text ?? ''), { gfm: true, async: false });
  const box = document.createElement('div');
  box.className = 'md';
  box.append(DOMPurify.sanitize(html, POLICY));
  for (const code of box.querySelectorAll('pre > code.language-mermaid')) {
    code.parentElement?.replaceWith(mermaid(code.textContent ?? ''));
  }
  for (const link of box.querySelectorAll('a')) link.title = link.getAttribute('href') ?? '';
  box.addEventListener('click', (event) => {
    if (event.target instanceof window.Element && event.target.closest('a, area')) event.preventDefault();
  });
  return box;
}

/**
 * The sources of a document's `mermaid` fences, from the lexer `markdown` draws with, each as the page passes it to
 * the diagram (marked's code block text, ending in one newline), so a drawing made ahead is the one the page finds.
 * @param {string} text @returns {string[]}
 */
export function mermaidSources(text) {
  /** @type {string[]} */
  const out = [];
  marked.walkTokens(marked.lexer(String(text ?? ''), { gfm: true }), (token) => {
    if (token.type === 'code' && /^\S*/.exec(token.lang ?? '')?.[0] === 'mermaid')
      out.push(`${token.text.replace(/\n$/, '')}\n`);
  });
  return out;
}
