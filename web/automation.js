import { Transaction } from '@codemirror/state';
import { app, newNote } from './app.js';
import { persistNow } from './persistence.js';
import { refreshNav } from './toolbar.js';
import { removeNote } from './delete-notices.js';
import { searchNotes } from './note-search.js';

// Note operations for MCP tools and inkflit:// links. They act on the live
// editor state and go through the normal save pipeline.
//
// request: {action, id?, index?, content?, query?, position?}
// action:  list | get | search | create | append | replace | delete
export async function notesOperation(request) {
  const state = app.state;
  if (!state || !request || typeof request !== 'object') throw new Error('Notes are not ready');
  const { action, id, index } = request;
  if (id !== undefined && index !== undefined) throw new Error('Specify either id or index, not both');
  const resolveNote = required => {
    if (id !== undefined) {
      if (typeof id !== 'string' || !id) throw new Error('Invalid note id');
      const note = state.notes.find(n => n.id === id); if (!note) throw new Error('Note not found'); return note;
    }
    if (index !== undefined) {
      if (!Number.isInteger(index) || index < 1 || index > state.notes.length) throw new Error('Note index out of range');
      return state.notes[index - 1];
    }
    if (required) throw new Error('A note id or 1-based index is required');
    return null;
  };
  const describe = note => ({ id: note.id, index: state.notes.indexOf(note) + 1, content: note.content, ...(note.created ? { created: note.created } : {}), updated: note.updated });

  if (action === 'list') return { notes: state.notes.map(describe) };
  if (action === 'get') return { note: describe(resolveNote(true)) };
  if (action === 'search') {
    if (typeof request.query !== 'string' || !request.query.trim()) throw new Error('A search query is required');
    return { results: searchNotes(state.notes, request.query) };
  }
  if (!['create', 'append', 'replace', 'delete'].includes(action)) throw new Error('Unknown note operation');
  if (action !== 'delete' && (typeof request.content !== 'string' || request.content.length > 1_000_000)) throw new Error('Content must be a string of at most 1000000 characters');
  let note = action === 'create' ? null : resolveNote(action === 'delete');
  if (action === 'create' && (id !== undefined || index !== undefined)) throw new Error('Create does not take a note target');
  if (action !== 'create' && request.position !== undefined) throw new Error('Position is only valid when creating a note');

  if (action === 'delete') {
    removeNote(state.notes.indexOf(note));
    await persistNow();
    return { deleted: note.id };
  }
  if (!note) {
    // New notes go last unless a position is given.
    let insertion = state.notes.length;
    const position = request.position;
    if (position === 'first') insertion = 0;
    else if (Number.isInteger(position) && position >= 1 && position <= state.notes.length + 1) insertion = position - 1;
    else if (position !== undefined && position !== 'last') throw new Error('Position must be first, last, or an insertion index from 1 through note count + 1');
    note = newNote(); note.content = request.content; state.notes.splice(insertion, 0, note); refreshNav();
  } else {
    const separator = action === 'append' && note.content && request.content && !note.content.endsWith('\n') && !request.content.startsWith('\n') ? '\n' : '';
    const text = action === 'append' ? note.content + separator + request.content : request.content;
    if (text !== note.content) {
      const spec = { changes: { from: 0, to: note.content.length, insert: text }, annotations: Transaction.userEvent.of('input.external'), filter: false };
      if (note.id === state.selected) app.editor.dispatch(spec);
      else { const cached = app.editorStates.get(note.id); if (cached) app.editorStates.set(note.id, cached.update(spec).state); note.content = text; note.updated = new Date().toISOString(); }
    }
  }
  await persistNow();
  return { note: describe(note) };
}
