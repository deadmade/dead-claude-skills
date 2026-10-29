// Boots the window: hands the view runtime the app's read-only commands and its events, and draws the list.
import { createRuntime } from './runtime.js';

const tauri = /** @type {any} */ (window).__TAURI__;
const root = document.getElementById('app');
if (!root) throw new Error('index.html has no #app');
createRuntime({ root, invoke: tauri.core.invoke, listen: tauri.event.listen }).start();
