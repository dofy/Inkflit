// Shared state for the note window. Modules read and write these fields
// directly instead of passing them around; `state` is what gets saved.
export const app = {
  state: null,              // {notes: [{id, content, created?, updated}], selected}
  editor: null,             // the EditorView of the selected note
  editorCache: new Map(),   // note id -> { state, scroll }, kept while the note is inactive
  vimEnabled: true,
  windowPinned: false,
  codeIndentation: 'spaces2',
  keyStartDoc: null,        // document before the current keystroke (Vim undo grouping)
  mergeFirstInsert: false,
};

export const $ = id => document.getElementById(id);
export const current = () => app.state.notes.find(note => note.id === app.state.selected);
export const newNote = (content = '') => { const now = new Date().toISOString(); return { id: crypto.randomUUID(), content, created: now, updated: now }; };

// The native app's message handler, absent when the page runs in a browser.
export const nativeHandler = () => window.webkit?.messageHandlers?.inkflit;
export function nativeCommand(action, value) { nativeHandler()?.postMessage({ type: 'command', action, ...(value === undefined ? {} : { value }) }); }

const completionMenus = new Set();
let completionInputRequested = false;
export function setCompletionInput(menu, open) {
  if (completionMenus.has(menu) === open) return;
  if (open) completionMenus.add(menu); else completionMenus.delete(menu);
  // Wait until CodeMirror has finished updating before asking macOS to change input sources.
  queueMicrotask(() => {
    const active = completionMenus.size > 0;
    if (active === completionInputRequested) return;
    completionInputRequested = active;
    if (nativeHandler()) window.prompt('inkflit-completion-input', active ? 'open' : 'closed');
  });
}

// Ask the native app for a value. It answers with window.resolveNativeRequest.
const nativeRequests = new Map();
let nextRequest = 0;
export function nativeRequest(action, timeout = 3000) {
  if (!nativeHandler()) return Promise.reject(new Error('Only available in the app'));
  return new Promise((resolve, reject) => {
    const id = ++nextRequest;
    const timer = setTimeout(() => { nativeRequests.delete(id); reject(new Error('No answer from the app')); }, timeout);
    nativeRequests.set(id, { resolve, reject, timer });
    nativeHandler().postMessage({ type: 'request', id, action });
  });
}
export function resolveNativeRequest(id, ok, value) {
  const request = nativeRequests.get(id);
  if (!request) return;
  nativeRequests.delete(id); clearTimeout(request.timer);
  if (ok) request.resolve(value); else request.reject(new Error(value || 'Request failed'));
}
