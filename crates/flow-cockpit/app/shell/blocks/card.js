// A quiet item between hairlines. Strings go in as text only; the error card is the one tinted card.

/** @param {import('../api').CardOpts} opts @returns {HTMLElement} */
export function card({ title, meta, body, error }) {
  const item = document.createElement('article');
  item.className = error ? 'card error' : 'card';
  if (error) item.setAttribute('role', 'alert');
  const head = document.createElement('h3');
  head.className = 'card-h';
  head.textContent = title;
  item.append(head);
  if (meta) {
    const line = document.createElement('p');
    line.className = 'card-meta';
    line.textContent = meta;
    item.append(line);
  }
  if (body !== undefined) {
    const box = document.createElement(typeof body === 'string' ? 'p' : 'div');
    box.className = 'card-body';
    if (typeof body === 'string') box.textContent = body;
    else box.append(body);
    item.append(box);
  }
  return item;
}
