// Boots the window: lists the projects and the chosen project's entries, through the app's read-only commands, and
// redraws on `changed`. Text goes in through textContent only. The view runtime (Task 7) replaces this.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const app = document.getElementById('app');
/** @type {string | null} */
let current = null;

/** @param {{ kind: string, [key: string]: any }} entry */
function describe(entry) {
  switch (entry.kind) {
    case 'FlowRun':
      return `${entry.slug}: ${entry.status}, ${entry.phase}`;
    case 'Audit':
      return `${entry.file}${entry.open ? ' (open)' : ''}`;
    default:
      return `${entry.first_prompt ?? entry.id} (${entry.last_activity})`;
  }
}

/** @param {string} tag @param {string} text */
function el(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

async function draw() {
  /** @type {{ id: string, name: string }[]} */
  const projects = await invoke('projects');
  if (!projects.some((p) => p.id === current)) current = projects[0]?.id ?? null;
  const picker = document.createElement('ul');
  for (const project of projects) {
    const button = el('button', project.name);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(project.id === current));
    button.addEventListener('click', () => {
      current = project.id;
      draw();
    });
    const item = document.createElement('li');
    item.append(button);
    picker.append(item);
  }
  const entries = current === null ? [] : await invoke('entries', { project: current });
  const list = document.createElement('ul');
  for (const entry of entries) list.append(el('li', describe(entry)));
  const empty = projects.length ? [] : [el('p', 'No Claude Code projects found yet.')];
  app.replaceChildren(el('h1', 'Flow cockpit'), ...empty, picker, list);
}

listen('changed', () => draw());
draw();
