import { Transaction } from '@codemirror/state';
import { app, newNote } from './app.js';
import { deferAutoSave, persistNow } from './persistence.js';
import { refreshNav } from './toolbar.js';
import { removeNote } from './delete-notices.js';
import { notePreview, searchNotes } from './note-search.js';
import { analyzeScopes, nestedLines } from './features.js';
import { currentRates } from './rates.js';
import { isChecklistItem, taskMarker } from './tasks.js';
import { noteFormatTransaction, previewNoteFormat } from './note-format.js';

function metadata(note, index) {
  return { id: note.id, index, ...(note.created ? { created: note.created } : {}), updated: note.updated };
}

const formatPreviews = new Map();
const maxFormatPreviews = 16;

function updateCachedEditor(cached, spec) {
  const transaction = cached.state.update(spec);
  cached.state = transaction.state;
  cached.scroll = cached.scroll?.map(transaction.changes);
}

async function previewFormatting(state, note) {
  const before = note.content;
  const preview = await previewNoteFormat(before, app.codeIndentation);
  if (app.state !== state || !state.notes.includes(note) || note.content !== before) {
    throw new Error('Note changed during formatting; preview it again');
  }
  if (!preview) return { changed: false, diff: '', preview_id: null };
  const id = crypto.randomUUID();
  // Store the exact patch the client reviewed. No reformatting on apply.
  if (formatPreviews.size >= maxFormatPreviews) formatPreviews.delete(formatPreviews.keys().next().value);
  formatPreviews.set(id, { state, note, before, doc: preview.doc, changes: preview.changes, content: preview.content });
  return { changed: true, diff: preview.diff, preview_id: id };
}

async function applyFormatting(state, note, previewID) {
  if (typeof previewID !== 'string' || !previewID) throw new Error('A preview_id is required');
  const preview = formatPreviews.get(previewID);
  if (!preview || preview.state !== state || preview.note !== note) {
    throw new Error('Preview is unavailable for this note; preview it again');
  }
  formatPreviews.delete(previewID);
  if (note.content !== preview.before) throw new Error('Note content changed since preview; preview it again');

  const spec = noteFormatTransaction(preview.changes);
  spec.filter = false; // Apply exactly the formatter's validated ranges.
  spec.annotations.push(deferAutoSave.of(true));
  if (state.selected === note.id) {
    const editor = app.editor;
    if (!editor?.state.doc.eq(preview.doc)) throw new Error('Editor content changed since preview; preview it again');
    editor.dispatch(spec);
  } else {
    const cached = app.editorCache.get(note.id);
    if (cached?.state.doc.eq(preview.doc)) updateCachedEditor(cached, spec);
    else if (cached) app.editorCache.delete(note.id);
  }
  note.content = preview.content;
  note.updated = new Date().toISOString();
  await persistNow();
}

function listNotes(notes, { limit, cursor, include_content: includeContent }) {
  // Keep the original unpaginated response for existing clients and URL callbacks.
  if (limit === undefined && cursor === undefined && includeContent === undefined) {
    return { notes: notes.map((note, index) => ({ ...metadata(note, index + 1), content: note.content })) };
  }
  const pageSize = limit === undefined ? 50 : limit;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('limit must be an integer from 1 to 100');
  if (includeContent !== undefined && typeof includeContent !== 'boolean') throw new Error('include_content must be a boolean');
  if (cursor !== undefined && (typeof cursor !== 'string' || !cursor)) throw new Error('cursor must be a non-empty string');
  const after = cursor === undefined ? -1 : notes.findIndex(note => note.id === cursor);
  if (cursor !== undefined && after < 0) throw new Error('Cursor note no longer exists; restart pagination without a cursor');
  const start = after + 1;
  const page = notes.slice(start, start + pageSize).map((note, offset) => {
    const header = metadata(note, start + offset + 1);
    if (includeContent !== false) return { ...header, content: note.content };
    const preview = notePreview(note.content).trim();
    const characters = Array.from(preview.slice(0, 321));
    const summary = characters.length > 160 ? characters.slice(0, 160).join('') + '…' : preview;
    return { ...header, summary };
  });
  return { notes: page, total: notes.length, next_cursor: start + page.length < notes.length ? page.at(-1).id : null };
}

function analyzeNote(content) {
  const lines = content.split('\n');
  const scopes = analyzeScopes(content, currentRates());
  const nested = nestedLines(scopes);
  return scopes.filter(scope => scope.mode !== 'code').map(scope => {
    const block = { mode: scope.mode, kind: scope.global ? 'note' : scope.kind,
      start_line: scope.start, end_line: Math.min(scope.end, lines.length),
      closed: scope.global || scope.closed, summary: scope.summary, results: scope.results };
    if (scope.stats) block.stats = scope.stats;
    if (scope.mode === 'list') {
      const tasks = [];
      for (let number = scope.start + 1; number <= scope.last; number++) {
        if (scope.global && nested.has(number)) continue;
        const line = { text: lines[number - 1], from: 0 };
        if (isChecklistItem(line)) tasks.push({ line: number, completed: taskMarker(line)?.checked ?? false });
      }
      const completed = tasks.filter(task => task.completed).length;
      block.stats = { items: tasks.length, completed, remaining: tasks.length - completed };
      block.tasks = tasks;
    }
    return block;
  });
}

// Note operations for MCP tools and inkflit:// links. They act on the live
// editor state and go through the normal save pipeline.
//
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
  const header = note => metadata(note, state.notes.indexOf(note) + 1);
  const describe = note => ({ ...header(note), content: note.content });

  if (action === 'list') return listNotes(state.notes, request);
  if (action === 'get') return { note: describe(resolveNote(true)) };
  if (action === 'current') {
    const note = state.notes.find(note => note.id === state.selected);
    if (!note) throw new Error('No current note');
    return { note: describe(note) };
  }
  if (action === 'analyze') {
    const note = resolveNote(true);
    return { note: header(note), blocks: analyzeNote(note.content) };
  }
  if (action === 'format-preview' || action === 'format-apply') {
    if (typeof id !== 'string' || !id) throw new Error('A stable note id is required');
    const note = resolveNote(true);
    if (action === 'format-preview') return { note: header(note), ...await previewFormatting(state, note) };
    await applyFormatting(state, note, request.preview_id);
    return { note: header(note), changed: true };
  }
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
    note = newNote(request.content); state.notes.splice(insertion, 0, note); refreshNav();
  } else {
    const separator = action === 'append' && note.content && request.content && !note.content.endsWith('\n') && !request.content.startsWith('\n') ? '\n' : '';
    const text = action === 'append' ? note.content + separator + request.content : request.content;
    if (text !== note.content) {
      const spec = { changes: { from: 0, to: note.content.length, insert: text }, annotations: Transaction.userEvent.of('input.external'), filter: false };
      if (note.id === state.selected) app.editor.dispatch(spec);
      else { const cached = app.editorCache.get(note.id); if (cached) updateCachedEditor(cached, spec); note.content = text; note.updated = new Date().toISOString(); }
    }
  }
  await persistNow();
  return { note: describe(note) };
}
