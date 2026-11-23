import { t } from './i18n.js';
import { app, $, current, newNote } from './app.js';
import { persist, latestRevision } from './persistence.js';
import { changeEditor } from './editor-view.js';
import { refreshNav } from './toolbar.js';
import { notePreview } from './note-search.js';

// Deleted notes stay restorable for 12 seconds, each with its own notice.
// `deleteOrder` remembers where every note was, so a restored note returns
// to its old place even after other notes were deleted or restored.
const NOTICE_SECONDS = 12;
const notices = new Map();
let deleteOrder = [], placeholderID = null, noticeTimer = null;
let deletionQueue = 0, deleting = false;

export const hasDeleteNotices = () => notices.size > 0;

function syncDeleteOrder() {
  const active = app.state.notes.map(note => note.id), available = new Set([...active, ...notices.keys()]);
  deleteOrder = deleteOrder.filter(id => available.has(id));
  for (let i = 0; i < active.length; i++) {
    const id = active[i]; if (deleteOrder.includes(id)) continue;
    const next = active.slice(i + 1).find(value => deleteOrder.includes(value));
    const previous = active.slice(0, i).reverse().find(value => deleteOrder.includes(value));
    const at = next ? deleteOrder.indexOf(next) : previous ? deleteOrder.indexOf(previous) + 1 : deleteOrder.length;
    deleteOrder.splice(at, 0, id);
  }
}

// Count down, drop expired notices, and mark the newest one as the ⌘U target.
export function updateDeleteNotices() {
  const now = Date.now();
  for (const [id, entry] of notices) {
    const remaining = Math.max(0, Math.ceil((entry.expires - now) / 1000));
    if (!remaining) { entry.element.remove(); notices.delete(id); continue; }
    entry.label.textContent = `${t('note.deleted')} · ${id.slice(0, 6)}`;
    entry.time.textContent = `${remaining}${t('note.secondsUnit')}`;
    entry.button.setAttribute('aria-label', `${t('note.undo')} ${entry.title}`);
  }
  const next = [...notices.keys()].at(-1);
  for (const [id, entry] of notices) {
    const highlighted = id === next; entry.element.classList.toggle('is-next', highlighted);
    entry.button.textContent = t('note.undo') + (highlighted ? ' ⌘U' : '');
    entry.button.title = highlighted ? '⌘U' : '';
  }
  if (!notices.size && noticeTimer) { clearInterval(noticeTimer); noticeTimer = null; }
}

function addDeleteNotice(note, savedEditor, placeholder) {
  const element = document.createElement('div'); element.className = 'delete-notice';
  const copy = document.createElement('div'); copy.className = 'delete-notice-copy';
  const label = document.createElement('div'); label.className = 'delete-notice-label';
  const title = document.createElement('div'); title.className = 'delete-notice-title';
  const display = Array.from(notePreview(note.content).trim() || t('note.empty')).slice(0, 80).join(''); title.textContent = display;
  const time = document.createElement('span'); time.className = 'delete-notice-time';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'delete-notice-undo';
  button.addEventListener('mousedown', event => event.preventDefault());
  button.addEventListener('click', () => restoreDeletedNote(note.id));
  copy.append(label, title); element.append(copy, time, button); $('delete-notices').prepend(element); $('delete-notices').scrollTop = 0;
  notices.set(note.id, { note, savedEditor, placeholder, title: display, element, label, time, button, expires: Date.now() + NOTICE_SECONDS * 1000 });
  if (!noticeTimer) noticeTimer = setInterval(updateDeleteNotices, 250); updateDeleteNotices();
}

// Take the note at `index` out of the list and show an undo notice. The last
// note is replaced by an empty placeholder, which a restore removes again.
export function removeNote(index) {
  syncDeleteOrder();
  const [note] = app.state.notes.splice(index, 1); let placeholder = null;
  if (!app.state.notes.length) { const empty = newNote(); placeholder = placeholderID = empty.id; app.state.notes.push(empty); }
  if (app.state.selected === note.id) changeEditor(app.state.notes[Math.min(index, app.state.notes.length - 1)].id);
  else refreshNav();
  const savedEditor = app.editorCache.get(note.id); app.editorCache.delete(note.id);
  addDeleteNotice(note, savedEditor, placeholder);
  return note;
}

export function restoreDeletedNote(id) {
  const entry = notices.get(id); if (!entry || entry.expires <= Date.now() || !app.state) return;
  const notes = app.state.notes;
  if (notes.some(note => note.id === id)) { entry.element.remove(); notices.delete(id); updateDeleteNotices(); return; }
  syncDeleteOrder();
  const placeholderIndex = entry.placeholder ? notes.findIndex(note => note.id === entry.placeholder && !note.content) : -1;
  if (placeholderIndex >= 0) { notes.splice(placeholderIndex, 1); if (placeholderID === entry.placeholder) placeholderID = null; }
  const rank = deleteOrder.indexOf(id), next = deleteOrder.slice(rank + 1).find(candidate => notes.some(note => note.id === candidate));
  const previous = deleteOrder.slice(0, rank).reverse().find(candidate => notes.some(note => note.id === candidate));
  const position = next ? notes.findIndex(note => note.id === next) : previous ? notes.findIndex(note => note.id === previous) + 1 : notes.length;
  notes.splice(position, 0, entry.note); if (entry.savedEditor) app.editorCache.set(id, entry.savedEditor);
  changeEditor(id); if (placeholderIndex >= 0) app.editorCache.delete(entry.placeholder);
  entry.element.remove(); notices.delete(id); updateDeleteNotices(); persist(true);
}

// The newest notice that has not expired: what ⌘U restores.
export function lastDeletedId() { updateDeleteNotices(); return [...notices.keys()].at(-1); }
export function restoreLastDeleted() { const id = lastDeletedId(); if (id) restoreDeletedNote(id); }

// ⌘D. Deletions queue up so fast repeats each save before the next delete.
export function deleteNote() {
  if (!app.state) return;
  deletionQueue++; processDeletionQueue();
}
function stopDeletionQueue() { deletionQueue = 0; deleting = false; }
function processDeletionQueue() {
  if (deleting || !app.state || deletionQueue === 0) return;
  deletionQueue--; deleting = true;
  const deleted = app.state.selected;
  if (app.state.notes.length === 1 && deleted === placeholderID && !current().content) { stopDeletionQueue(); return; }
  const saveBeforeDelete = () => persist(true, (ok, revision) => {
    if (!ok || !app.state || app.state.selected !== deleted) { stopDeletionQueue(); return; }
    if (revision < latestRevision()) { saveBeforeDelete(); return; }
    const index = app.state.notes.findIndex(note => note.id === deleted);
    if (index < 0) { stopDeletionQueue(); return; }
    removeNote(index);
    persist(true, success => { if (!success) deletionQueue = 0; deleting = false; processDeletionQueue(); });
  });
  saveBeforeDelete();
}
