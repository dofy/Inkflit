import { getCM } from '@replit/codemirror-vim';
import { completionStatus, closeCompletion, acceptCompletion, moveCompletionSelection, hasNextSnippetField, hasPrevSnippetField, nextSnippetField, prevSnippetField, clearSnippet } from '@codemirror/autocomplete';
import { indentMore, indentLess } from '@codemirror/commands';
import { app, $ } from './app.js';
import { t } from './i18n.js';
import { isEditing } from './editor-view.js';
import { acceptBestSnippet, backSnippetMenu, snippetMenuIsEmpty } from './snippet-completion.js';
import { commandPalette, searchPalette } from './palettes.js';
import { commandShortcut, runCommand, runShortcut } from './commands.js';
import { blockMenuOpen, trySlash, handleBlockMenuKey } from './block-menu.js';
import { languageMenuOpen, handleLanguageMenuKey } from './language-menu.js';
import { scopeAt } from './features.js';
import { planCodeEdit } from './code-editing.js';
import { planListIndent } from './list-editing.js';
import { checklistToggleChange } from './tasks.js';

// Every shortcut in the note window, checked in order from the most global
// (palettes) to the most local (the cursor's block). The listener runs in the
// capture phase, so it sees keys before CodeMirror and Vim do.

const plain = event => !event.metaKey && !event.ctrlKey && !event.altKey;
const consume = event => { event.preventDefault(); event.stopPropagation(); };

const escapeInterval = 600;
let vimDoubleEscape = true;
let escapeDeadline = 0, escapeTimer;
export function setVimDoubleEscape(enabled) {
  vimDoubleEscape = enabled;
  clearEscapeHint();
}
export function clearEscapeHint() {
  if (!escapeDeadline) return;
  escapeDeadline = 0;
  clearTimeout(escapeTimer);
  $('escape-hint').hidden = true;
}
function vimEscapeToHide() {
  const now = performance.now();
  const confirmed = now < escapeDeadline;
  clearEscapeHint();
  if (confirmed) { runCommand('hide-window'); return; }
  const hint = $('escape-hint');
  hint.textContent = t('editor.escapeToHide');
  hint.hidden = false;
  escapeDeadline = now + escapeInterval;
  escapeTimer = setTimeout(clearEscapeHint, escapeInterval);
}

// ⌘⇧P and ⌘⇧F toggle their palette from anywhere, switching away from the other one.
// An open palette handles its own keys; editor tools at the cursor (⌘L, ⌘O)
// close it instead of being swallowed. Returns true when the key is done.
function palettesKey(event) {
  if (runShortcut(event, 'palette')) { consume(event); return true; }
  const palette = commandPalette.open ? commandPalette : searchPalette.open ? searchPalette : null;
  if (!palette) return false;
  if (palette.handleKey(event)) { consume(event); return true; }
  if (commandShortcut(event, 'before-menu')?.closePalette) { palette.close(); return false; }
  return true;
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
  if (scopeAt(editor.state.doc, line.number)?.mode !== 'list') return false;
  if (!sel.empty || sel.head !== line.to || !line.text.endsWith('/') || line.number <= 1 || /^\s*(?:\/\/|#)/.test(line.text)) return false;
  const changes = [{ from: line.to - 1, to: line.to }, checklistToggleChange(editor.state, line)];
  consume(event); editor.dispatch({ changes, userEvent: 'input.task.toggle' });
  return true;
}

// Vim handles Escape first when it has a mode or command to cancel.
function escapeKey(event) {
  const endedStops = !!app.editor && clearSnippet(app.editor);
  const cm = getCM(app.editor), vimState = cm?.state?.vim, input = vimState?.inputState;
  const pending = !!(cm?.state?.dialog || vimState?.insertMode || vimState?.visualMode || vimState?.exMode || input?.keyBuffer?.length || input?.operator || input?.motion || input?.repeatOverride || input?.registerName);
  if (pending || endedStops) clearEscapeHint();
  if (pending) return;
  consume(event);
  if (endedStops || app.windowPinned) return;
  if (app.vimEnabled && vimState && vimDoubleEscape) vimEscapeToHide();
  else runCommand('hide-window');
}

// While the snippet list is open, its keys belong to it (snippet-completion.js).
// Handled here rather than by keymap, because Vim's keys take precedence over
// CodeMirror keymaps. Esc goes up a level or closes the list at the root.
const completionKeys = {
  Enter: acceptCompletion, Tab: acceptCompletion, Escape: editor => backSnippetMenu(editor) || closeCompletion(editor),
  ArrowDown: moveCompletionSelection(true), ArrowUp: moveCompletionSelection(false),
  PageDown: moveCompletionSelection(true, 'page'), PageUp: moveCompletionSelection(false, 'page'),
};
function completionKey(event) {
  const editor = app.editor, run = completionKeys[event.key];
  if (!editor || !run || !plain(event) || event.shiftKey) return false;
  const status = completionStatus(editor.state);
  // 'pending': the list is still updating for the last keystroke.
  if (status === 'pending' && run === acceptCompletion) { if (!acceptBestSnippet(editor)) return false; consume(event); return true; }
  if (status !== 'active' && !(status === 'pending' && event.key === 'Escape')) return false;
  if (event.key !== 'Escape' && snippetMenuIsEmpty(editor.state)) { closeCompletion(editor); return false; }
  consume(event); run(editor);
  return true;
}

// After a snippet with caret stops, Tab and ⇧Tab move to the next and
// previous stop. While stops are active both keys belong to them, so ⇧Tab
// on the first stop does nothing rather than outdent. Reaching the last stop,
// leaving the stops or Esc ends this.
function snippetFieldKey(event) {
  const editor = app.editor;
  if (!editor?.hasFocus || event.key !== 'Tab' || !plain(event)) return false;
  // An active snippet always has a next stop; the last one ends it.
  if (!hasNextSnippetField(editor.state)) return false;
  consume(event);
  if (!event.shiftKey) nextSnippetField(editor);
  else if (hasPrevSnippetField(editor.state)) prevSnippetField(editor);
  return true;
}

function onKeyDown(event) {
  const escape = event.key === 'Escape' && plain(event) && !event.shiftKey;
  if (!escape || event.isComposing || event.keyCode === 229) clearEscapeHint();
  if (!app.state || event.isComposing || event.keyCode === 229) return;
  if (palettesKey(event) || completionKey(event)) { clearEscapeHint(); return; }
  if (snippetFieldKey(event)) return;
  const editor = app.editor, focused = !!editor?.hasFocus, menusClosed = () => !languageMenuOpen() && !blockMenuOpen();

  if (runShortcut(event, 'early')) { consume(event); return; }
  app.keyStartDoc = editor?.state.doc;
  if (runShortcut(event, 'before-menu')) { consume(event); return; }
  if (languageMenuOpen() && handleLanguageMenuKey(event)) { clearEscapeHint(); consume(event); return; }
  if (blockMenuOpen() && handleBlockMenuKey(event)) { clearEscapeHint(); consume(event); return; }
  if (runShortcut(event, 'after-menu')) { consume(event); return; }
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
  if (runShortcut(event, 'main')) { consume(event); return; }
  if (escape && !event.repeat) escapeKey(event);
}

export function installKeys() {
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', clearEscapeHint, true);
  window.addEventListener('blur', clearEscapeHint);
}
