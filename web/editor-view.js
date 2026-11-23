import { EditorState, Text, Transaction, Compartment, Prec } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, defaultHighlightStyle, syntaxTree } from '@codemirror/language';
import { classHighlighter, tags } from '@lezer/highlight';
import { vim, Vim, getCM, CodeMirror } from '@replit/codemirror-vim';
import { app, $, current, nativeHandler } from './app.js';
import { deferAutoSave, persist } from './persistence.js';
import { refreshNav } from './toolbar.js';
import { codeLanguage } from './code-languages.js';
import { blockProtection, nearestEditablePosition, visibleCopiedText, markerRanges } from './block-protection.js';
import { listPasteRules } from './list-editing.js';
import { closeBlockMenu, updateBlockMenu, openMenuAfterInput } from './block-menu.js';
import { languageMenuOpen, closeLanguageMenu } from './language-menu.js';
import { tasks, taskContentPosition } from './tasks.js';
import { features, analyzeCurrent, setRateListener, rateEffect } from './feature-view.js';
import { scopeAt, calculationModes, markdownBlockMarkers } from './features.js';
import { noteComments, isCodeAt } from './comments.js';
import { noteHeadings, noteInlineCode, noteListIndent } from './typography.js';
import { snippets } from './snippet-completion.js';
import { closeCompletion, completionStatus } from '@codemirror/autocomplete';
import { cancelPageSlide, replaceNotePage } from './page-slide.js';

// Markdown tokens that defaultHighlightStyle colors for light mode only
// (#219 dark blue): give them theme colors. Scoped to Markdown, so code
// inside fenced blocks keeps its syntax theme.
const markdownColors = HighlightStyle.define([
  { tag: tags.meta, class: 'inkflit-md-meta' },
  { tag: tags.url, class: 'inkflit-md-url' },
  { tag: tags.labelName, class: 'inkflit-md-label' },          // ```ts info string, [link][label]
  { tag: tags.contentSeparator, class: 'inkflit-md-meta' }    // --- horizontal rule
], { scope: markdownLanguage });
const vimCompartment = new Compartment();
// Like Vim's scrolloff=3: keep three lines visible beyond the cursor while
// there is content past the viewport; at the ends CodeMirror clamps naturally.
// CodeMirror also hides tooltips inside these margins, so drop them while the
// snippet list is open, or it would vanish near the top and bottom.
const scrollOff = EditorView.scrollMargins.of(view => {
  if (completionStatus(view.state)) return null;
  const margin = view.defaultLineHeight * 3; return { top: margin, bottom: margin };
});

// An unindented line right after "- item" belongs to that item in Markdown
// (a lazy continuation), so Markdown's Enter would indent the next line into
// the item. Keep it unindented, as the line looks. List lines keep their
// usual continuation.
export function plainEnterAfterList(state) {
  const selection = state.selection.main;
  if (!selection.empty) return null;
  const line = state.doc.lineAt(selection.head);
  // In math, sum, avg and count, "12. 0.2" is data: Return never continues a list.
  if (calculationModes.has(scopeAt(state.doc, line.number)?.mode)) return { changes: { from: selection.head, insert: '\n' }, selection: { anchor: selection.head + 1 }, scrollIntoView: true, userEvent: 'input' };
  if (/^\s/.test(line.text) || /^(?:[-+*]|\d+[.)])(?:\s|$)/.test(line.text) || isCodeAt(state, selection.head)) return null;
  let inList = false;
  for (let node = syntaxTree(state).resolveInner(line.from, 1); node; node = node.parent) if (node.name === 'ListItem') { inList = true; break; }
  return inList ? { changes: { from: selection.head, insert: '\n' }, selection: { anchor: selection.head + 1 }, scrollIntoView: true, userEvent: 'input' } : null;
}
const plainEnter = Prec.highest(keymap.of([{ key: 'Enter', run: view => { const plan = plainEnterAfterList(view.state); if (plan) view.dispatch(plan); return !!plan; } }]));

// True when keystrokes insert text: Vim is off, or Vim is in insert mode.
export const isEditing = () => !app.vimEnabled || !!getCM(app.editor)?.state?.vim?.insertMode;

export function prepareToHide() {
  cancelPageSlide();
  const editor = app.editor;
  if (!editor) return;
  closeBlockMenu();
  closeCompletion(editor);
  if (!app.vimEnabled) return;
  const cm = getCM(editor);
  if (cm?.state?.vim?.insertMode) Vim.handleKey(cm, '<Esc>', 'user');
  // WebKit can retain the DOM focus when AppKit orders the window out.
  editor.contentDOM.blur();
  editor.dispatch([]);
}

// Merge the first insert after a Vim command into a single undo step with it.
const mergeFirstInsert = EditorState.transactionFilter.of(tr => {
  if (!app.mergeFirstInsert || !tr.docChanged || !tr.isUserEvent('input.type')) return tr;
  app.mergeFirstInsert = false;
  if (tr.annotation(Transaction.userEvent) === 'input.type.compose') return tr;
  return { changes: tr.changes, selection: tr.selection, effects: tr.effects, scrollIntoView: tr.scrollIntoView,
    annotations: [Transaction.userEvent.of('input.type.compose'), ...tr.annotations.filter(a => a.type !== Transaction.userEvent)] };
});

const saveOnChange = EditorView.updateListener.of(update => {
  if (languageMenuOpen() && (update.docChanged || update.selectionSet)) closeLanguageMenu();
  if (!update.docChanged || !app.state) return;
  current().content = update.state.doc.toString(); current().updated = new Date().toISOString();
  refreshInsights(); updateBlockMenu(); if (isEditing()) openMenuAfterInput(update);
  if (!update.transactions.some(transaction => transaction.annotation(deferAutoSave))) persist();
});

function makeState(content) {
  const initial = EditorState.create({ doc: content, selection: { anchor: nearestEditablePosition(Text.of(content.split('\n')), 0, 0, true) }, extensions: [
    vimCompartment.of(app.vimEnabled ? vim() : []), history(), blockProtection, listPasteRules, EditorView.clipboardOutputFilter.of(visibleCopiedText), mergeFirstInsert,
    drawSelection(), highlightActiveLine(), markdown({ codeLanguages: codeLanguage, extensions: markdownBlockMarkers }), tasks, features, noteComments, noteHeadings, noteInlineCode, noteListIndent,
    syntaxHighlighting(defaultHighlightStyle), syntaxHighlighting(markdownColors), syntaxHighlighting(classHighlighter), EditorView.lineWrapping, scrollOff, snippets,
    plainEnter, keymap.of([...defaultKeymap, ...historyKeymap]),
    saveOnChange
  ] });
  const position = taskContentPosition(initial, initial.selection.main.head);
  return position === initial.selection.main.head ? initial : initial.update({ selection: { anchor: position } }).state;
}

function unmountEditor(keepHistory) {
  closeBlockMenu(); closeLanguageMenu();
  if (!app.editor) return;
  closeCompletion(app.editor);
  if (keepHistory) app.editorStates.set(app.state.selected, app.editor.state);
  app.editor.destroy();
  app.editor = null;
}

function mountEditor(id) {
  app.state.selected = id;
  app.editor = new EditorView({ parent: $('editor'), state: app.editorStates.get(id) || makeState(current().content) });
  bindVimMode();
  refreshNav(); refreshInsights(); app.editor.focus();
}

// Navigation retains each note's undo history.
export function changeEditor(id, direction = 0) {
  replaceNotePage(direction, () => {
    unmountEditor(true);
    mountEditor(id);
  });
}

export function loadNoteSnapshot(snapshot) {
  // Reloaded notes may reuse IDs with different content after rebuilding the index.
  cancelPageSlide();
  unmountEditor(false);
  app.editorStates.clear();
  app.state = snapshot;
  mountEditor(snapshot.selected);
}

function bindVimMode() {
  $('mode').hidden = !app.vimEnabled;
  const cm = getCM(app.editor);
  if (!app.vimEnabled || !cm) {
    if (nativeHandler()) window.prompt('inkflit-input-mode', 'insert');
    return;
  }
  cm.on('vim-mode-change', event => {
    if (event.mode === 'insert') app.mergeFirstInsert = !!app.keyStartDoc && app.editor.state.doc !== app.keyStartDoc;
    else app.mergeFirstInsert = false;
    const mode = event.mode || 'normal';
    $('mode').textContent = String(mode).toUpperCase();
    // Wait for the native input source switch before the next keystroke can
    // reach the IME; a queued message can race with fast Vim/pinyin input.
    if (nativeHandler()) window.prompt('inkflit-input-mode', mode);
  });
  $('mode').textContent = 'NORMAL';
  if (nativeHandler()) window.prompt('inkflit-input-mode', 'normal');
}

export function setVimEnabled(value) {
  const enabled = !!value;
  if (enabled === app.vimEnabled) return;
  app.vimEnabled = enabled; app.mergeFirstInsert = false;
  closeBlockMenu(); closeLanguageMenu();
  for (const [id, cached] of app.editorStates) app.editorStates.set(id, cached.update({ effects: vimCompartment.reconfigure(enabled ? vim() : []) }).state);
  if (app.editor) { closeCompletion(app.editor); app.editor.dispatch({ effects: vimCompartment.reconfigure(enabled ? vim() : []) }); bindVimMode(); }
}

// The summary line for feature blocks, shown under the editor.
export function refreshInsights() {
  if (!app.editor) return;
  const info = analyzeCurrent(app.editor.state.doc);
  $('insights').textContent = info.summary; $('insights').hidden = !info.summary;
}
// Recompute block results, for example after exchange rates arrive or the language changes.
export function refreshBlockResults() {
  if (!app.editor) return;
  app.editor.dispatch({ effects: rateEffect.of(null) }); refreshInsights();
}
setRateListener(refreshBlockResults);

// Vim yanks bypass CodeMirror's clipboard filter, so filter their selected text too.
const registers = Vim.getRegisterController();
const originalPushText = registers.pushText;
registers.pushText = function (name, operator, text, linewise, blockwise) {
  if (app.editor && typeof text === 'string') text = visibleCopiedText(text, app.editor.state);
  return originalPushText.call(this, name, operator, text, linewise, blockwise);
};
Vim.defineEx('write', 'w', () => { if (app.state) persist(true); });

// Vim search (/ ? * # n N) skips matches in hidden block marker lines, so
// "list" is not found inside ":::inkflit list".
const searchCursor = CodeMirror.prototype.getSearchCursor;
CodeMirror.prototype.getSearchCursor = function (query, pos) {
  const cursor = searchCursor.call(this, query, pos), find = cursor.find.bind(cursor);
  cursor.find = back => {
    const doc = this.cm6.state.doc, markers = markerRanges(doc);
    const offset = position => doc.line(position.line + 1).from + position.ch;
    for (;;) {
      const found = find(back);
      if (!found) return found;
      const from = offset(cursor.from());
      if (!markers.some(marker => from >= marker.from && from <= marker.to)) return found;
    }
  };
  return cursor;
};
