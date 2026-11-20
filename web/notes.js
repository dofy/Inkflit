import { app, newNote } from './app.js';
import { persist } from './persistence.js';
import { changeEditor } from './editor-view.js';

// Notes are ordered like pages: the first is the oldest, new notes go last.
export function select(id) { if (!app.state || app.state.selected === id) return; changeEditor(id); persist(true); }
export function createNote(content = '') {
  if (!app.state) return;
  const note = newNote(content);
  app.state.notes.push(note);
  changeEditor(note.id);
  persist(true);
}

export function addGuideNotes(contents) {
  const notes = contents.map(content => newNote(content));
  app.state.notes.unshift(...notes);
  changeEditor(notes[0].id);
  persist(true);
  return notes.length;
}

export function navigate(direction) {
  if (!app.state) return;
  const index = app.state.notes.findIndex(note => note.id === app.state.selected), next = index + direction;
  if (next >= 0 && next < app.state.notes.length) select(app.state.notes[next].id);
}
// ⌘1–⌘9: the note at a 1-based position, if there is one.
export function selectAt(position) { const note = app.state?.notes[position - 1]; if (note) select(note.id); }
// ⌘⇧[ and ⌘⇧]: the first and the last note.
export function selectFirst() { selectAt(1); }
export function selectLast() { const notes = app.state?.notes; if (notes?.length) select(notes[notes.length - 1].id); }
