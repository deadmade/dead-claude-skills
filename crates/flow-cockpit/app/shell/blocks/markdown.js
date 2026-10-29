// Untrusted text to HTML, in one place: marked, then DOMPurify on every output. Scripts, event handlers,
// `javascript:` links, forms and styles are gone before anything reaches the page, and a link never navigates the
// window. A fenced `mermaid` block becomes a diagram.
import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';
import { mermaid } from './mermaid.js';

const POLICY = { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ['style', 'form'], FORBID_ATTR: ['style'] };

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
    if (event.target instanceof window.Element && event.target.closest('a')) event.preventDefault();
  });
  return box;
}
