import { Vim, getCM } from '@replit/codemirror-vim';
import { completionStatus, closeCompletion, acceptCompletion, moveCompletionSelection } from '@codemirror/autocomplete';
import { toggleLineComment, indentMore, indentLess } from '@codemirror/commands';
import { app, nativeHandler } from './app.js';
import { isEditing } from './editor-view.js';
import { acceptBestSnippet } from './snippet-completion.js';
import { commandPalette, searchPalette, openCommands, openSearch } from './palettes.js';
import { lastDeletedId, restoreDeletedNote, deleteNote } from './delete-notices.js';
import { createNote, navigate, selectAt } from './notes.js';
import { blockMenuOpen, trySlash, handleBlockMenuKey, deleteCurrentBlock, openCurrentBlockMenu, planAdjacentBlockLine, planAdjacentTextLine } from './block-menu.js';
import { languageMenuOpen, closeLanguageMenu, handleLanguageMenuKey, openCurrentLanguageMenu } from './language-menu.js';
import { scopeAt } from './features.js';
import { commentChanges, blockCodeCommentChanges, isCodeAt, selectedLines } from './comments.js';
import { planCodeEdit } from './code-editing.js';
import { planListIndent } from './list-editing.js';

// Every shortcut in the note window, checked in order from the most global
// (palettes) to the most local (the cursor's block). The listener runs in the
// capture phase, so it sees keys before CodeMirror and Vim do.

const command = (event, key, { shift = false } = {}) => event.metaKey && event.shiftKey === shift && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === key;
const plain = event => !event.metaKey && !event.ctrlKey && !event.altKey;
const consume = event => { event.preventDefault(); event.stopPropagation(); };

export function hide() {
  if (nativeHandler()) nativeHandler().postMessage({ type: 'hide' });
  else window.inkflitHideRequested = (window.inkflitHideRequested || 0) + 1;
}

// ⌘⇧P and ⌘⇧F toggle their palette from anywhere, switching away from the other one.
// An open palette handles its own keys; editor tools at the cursor (⌘L, ⌘O)
// close it instead of being swallowed. Returns true when the key is done.
function palettesKey(event) {
  if (command(event, 'p', { shift: true }) || command(event, 'f', { shift: true })) {
    consume(event); if (event.repeat) return true;
    const [target, open] = event.key.toLowerCase() === 'p' ? [commandPalette, openCommands] : [searchPalette, () => openSearch()];
    if (target.open) target.close(); else open();
    return true;
  }
  const palette = commandPalette.open ? commandPalette : searchPalette.open ? searchPalette : null;
  if (!palette) return false;
  if (palette.handleKey(event)) { consume(event); return true; }
  if (command(event, 'l') || command(event, 'o')) { palette.close(); return false; }
  return true;
}

// ⌘O / ⌘⇧O: an empty line below / above the current line or block, in insert mode.
function insertAdjacentLine(event) {
  const editor = app.editor;
  let plan = planAdjacentBlockLine(editor.state, event.shiftKey) ?? planAdjacentTextLine(editor.state, event.shiftKey);
  if (!plan) return;
  consume(event);
  if (event.repeat) return;
  const cm = getCM(editor);
  if (cm?.state?.vim?.visualMode) { Vim.handleKey(cm, '<Esc>', 'user'); plan = planAdjacentBlockLine(editor.state, event.shiftKey) ?? planAdjacentTextLine(editor.state, event.shiftKey); }
  if (!plan) return;
  editor.dispatch(plan);
  if (cm && !cm.state.vim?.insertMode) Vim.handleKey(cm, 'i', 'user');
  editor.focus();
}

// Tab in a checklist indents items; in Vim normal mode it does nothing.
function tabKey(event) {
  const editor = app.editor;
  const planned = planListIndent(editor.state, event.shiftKey ? 'Shift-Tab' : 'Tab');
  if (planned) { consume(event); editor.dispatch(planned); return true; }
  const cm = getCM(editor), mode = cm?.state?.vim;
  if (app.vimEnabled && mode && !mode.insertMode && !mode.visualMode && !cm.state.dialog) { consume(event); return true; }
  return false;
}

// Typing "/x" at the end of a checklist line ticks or unticks it.
function toggleTaskKey(event) {
  const editor = app.editor, sel = editor.state.selection.main, line = editor.state.doc.lineAt(sel.head);
  if (scopeAt(editor.state.doc.toString(), line.number)?.mode !== 'list') return false;
  if (!sel.empty || sel.head !== line.to || !line.text.endsWith('/') || line.number <= 1 || /^\s*(?:\/\/|#)/.test(line.text)) return false;
  const match = /^(\s*(?:(?:[-+*]|\d+[.)])\s+)?)\[([ xX])\](?=\s|$)/.exec(line.text);
  const changes = [{ from: line.to - 1, to: line.to }];
  if (match) changes.push({ from: line.from + match[1].length + 1, to: line.from + match[1].length + 2, insert: /[xX]/.test(match[2]) ? ' ' : 'x' });
  else changes.push({ from: line.from + /^\s*/.exec(line.text)[0].length, insert: '[x] ' });
  consume(event); editor.dispatch({ changes, userEvent: 'input.task.toggle' });
  return true;
}

// Return on the last empty line of a non-code block leaves the block.
function leaveBlockKey(event) {
  const editor = app.editor, selection = editor.state.selection.main;
  const line = editor.state.doc.lineAt(selection.head), scope = scopeAt(editor.state.doc.toString(), line.number);
  if (!selection.empty || scope?.kind !== 'block' || scope.mode === 'code' || line.number !== scope.end - 1 || line.text.trim() || scope.end > editor.state.doc.lines) return false;
  const end = editor.state.doc.line(scope.end);
  consume(event);
  if (end.to === editor.state.doc.length) editor.dispatch({ changes: { from: end.to, insert: '\n' }, selection: { anchor: end.to + 1 }, userEvent: 'input.block.exit' });
  else editor.dispatch({ selection: { anchor: end.to + 1 }, scrollIntoView: true });
  return true;
}

// ⌘C with nothing selected in a code block copies the whole block.
function copyCodeBlock(event) {
  const editor = app.editor, doc = editor.state.doc, line = doc.lineAt(editor.state.selection.main.head);
  const scope = scopeAt(doc.toString(), line.number);
  if (scope?.mode !== 'code') return false;
  const from = scope.start < doc.lines ? doc.line(scope.start + 1).from : doc.length;
  const to = scope.end <= doc.lines ? doc.line(scope.end).from - 1 : doc.length;
  const content = doc.sliceString(from, Math.max(from, to));
  if (nativeHandler()) { consume(event); nativeHandler().postMessage({ type: 'copyCode', content }); return true; }
  if (navigator.clipboard?.writeText) { consume(event); navigator.clipboard.writeText(content).catch(() => {}); return true; }
  return false;
}

// ⌘/ toggles comments; code blocks use their language's comment syntax.
function toggleComments() {
  const editor = app.editor, lines = selectedLines(editor.state);
  const customCode = blockCodeCommentChanges(editor.state);
  if (customCode) { if (customCode.length) editor.dispatch({ changes: customCode, userEvent: 'input.comment' }); return; }
  const inCode = lines.length && lines.every(line => isCodeAt(editor.state, line.from));
  if (!inCode || !toggleLineComment(editor)) {
    const changes = commentChanges(editor.state, { includeCode: !!inCode });
    if (changes.length) editor.dispatch({ changes, userEvent: 'input.comment' });
  }
}

// Esc hides the window unless Vim still has something to finish.
function escapeKey(event) {
  const cm = getCM(app.editor), vimState = cm?.state?.vim, input = vimState?.inputState;
  const pending = !!(cm?.state?.dialog || vimState?.insertMode || vimState?.visualMode || vimState?.exMode || input?.keyBuffer?.length || input?.operator || input?.motion || input?.repeatOverride || input?.registerName);
  if (!pending) { consume(event); hide(); }
}

// While the snippet list is open, its keys belong to it (snippet-completion.js).
// Handled here rather than by keymap, because Vim's keys take precedence over
// CodeMirror keymaps. Esc only closes the list, so it neither hides the window
// nor leaves insert mode.
const completionKeys = {
  Enter: acceptCompletion, Tab: acceptCompletion, Escape: closeCompletion,
  ArrowDown: moveCompletionSelection(true), ArrowUp: moveCompletionSelection(false),
  PageDown: moveCompletionSelection(true, 'page'), PageUp: moveCompletionSelection(false, 'page'),
};
function completionKey(event) {
  const editor = app.editor, run = completionKeys[event.key];
  if (!editor || !run || !plain(event) || event.shiftKey) return false;
  const status = completionStatus(editor.state);
  // 'pending': the list is still updating for the last keystroke.
  if (status === 'pending' && run === acceptCompletion) { if (!acceptBestSnippet(editor)) return false; consume(event); return true; }
  if (status !== 'active') return false;
  consume(event); run(editor);
  return true;
}

function onKeyDown(event) {
  if (!app.state || event.isComposing || event.keyCode === 229) return;
  if (palettesKey(event)) return;
  if (completionKey(event)) return;
  const editor = app.editor, focused = !!editor?.hasFocus, menusClosed = () => !languageMenuOpen() && !blockMenuOpen();

  if (command(event, 'u')) {
    const id = lastDeletedId();
    if (id) { consume(event); if (!event.repeat) restoreDeletedNote(id); return; }
  }
  app.keyStartDoc = editor?.state.doc;
  if (command(event, 'l') && focused) {
    if (!event.repeat && openCurrentLanguageMenu(editor)) consume(event);
    return;
  }
  if (command(event, 'k') && focused) {
    if (!event.repeat && openCurrentBlockMenu(editor)) { closeLanguageMenu(); consume(event); }
    return;
  }
  if (event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'o' && focused && menusClosed()) { insertAdjacentLine(event); return; }
  if (command(event, 'd', { shift: true })) { consume(event); if (!event.repeat) deleteCurrentBlock(editor); return; }
  if (languageMenuOpen() && handleLanguageMenuKey(event)) { consume(event); return; }
  if (blockMenuOpen() && handleBlockMenuKey(event)) { consume(event); return; }
  if (menusClosed() && focused && event.key === 'Tab' && plain(event) && tabKey(event)) return;
  if (menusClosed() && focused && plain(event) && isEditing()) {
    const key = event.key === 'Tab' && event.shiftKey ? 'Shift-Tab' : event.key;
    const planned = planCodeEdit(editor.state, key, { indentation: app.codeIndentation });
    if (planned) { consume(event); editor.dispatch(planned); return; }
  }
  // Any other Tab indents or outdents the line. It must never reach the
  // browser, which would move focus out of the editor (and, in the app, out of
  // the web view, after which Esc stopped working).
  if (event.key === 'Tab' && plain(event) && focused) {
    consume(event);
    if (isEditing()) (event.shiftKey ? indentLess : indentMore)(editor);
    return;
  }
  if (!blockMenuOpen() && isEditing() && trySlash(event, editor)) { consume(event); return; }
  if (event.key.toLowerCase() === 'x' && plain(event) && isEditing() && toggleTaskKey(event)) return;
  if (event.key === 'Enter' && !event.repeat && plain(event) && isEditing() && leaveBlockKey(event)) return;
  if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    const key = event.key.toLowerCase();
    if (key === 'c' && editor.state.selection.main.empty && copyCodeBlock(event)) return;
    if (key === '/') { consume(event); toggleComments(); return; }
    if (['n', 'd', '[', ']'].includes(key) || /^[1-9]$/.test(key)) {
      consume(event);
      if (key === 'n') createNote(); else if (key === 'd') deleteNote(); else if (key === '[') navigate(-1); else if (key === ']') navigate(1);
      else selectAt(Number(key));
      return;
    }
  }
  if (event.key === 'Escape' && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && !event.repeat) escapeKey(event);
}

export function installKeys() { document.addEventListener('keydown', onKeyDown, true); }
