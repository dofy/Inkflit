import { EditorState, Text, Transaction, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { classHighlighter, tags } from '@lezer/highlight';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { app, $, current, nativeHandler } from './app.js';
import { persist } from './persistence.js';
import { refreshNav } from './toolbar.js';
import { codeLanguage } from './code-languages.js';
import { blockProtection, nearestEditablePosition, visibleCopiedText } from './block-protection.js';
import { closeBlockMenu, updateBlockMenu, openMenuAfterInput } from './block-menu.js';
import { languageMenuOpen, closeLanguageMenu } from './language-menu.js';
import { tasks, taskContentPosition } from './tasks.js';
import { features, analyzeCurrent, setRateListener, rateEffect } from './feature-view.js';
import { noteComments } from './comments.js';
import { noteHeadings } from './typography.js';

const markdownColors = HighlightStyle.define([
  { tag: tags.meta, class: 'inkflit-md-meta' },
  { tag: tags.url, class: 'inkflit-md-url' }
], { scope: markdownLanguage });
const vimCompartment = new Compartment();
// Like Vim's scrolloff=3: keep three lines visible beyond the cursor while
// there is content past the viewport; at the ends CodeMirror clamps naturally.
const scrollOff = EditorView.scrollMargins.of(view => { const margin = view.defaultLineHeight * 3; return { top: margin, bottom: margin }; });

// True when keystrokes insert text: Vim is off, or Vim is in insert mode.
export const isEditing = () => !app.vimEnabled || !!getCM(app.editor)?.state?.vim?.insertMode;

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
  refreshInsights(); updateBlockMenu(); if (isEditing()) openMenuAfterInput(update); persist();
});

function makeState(content) {
  const initial = EditorState.create({ doc: content, selection: { anchor: nearestEditablePosition(Text.of(content.split('\n')), 0, 0, true) }, extensions: [
    vimCompartment.of(app.vimEnabled ? vim() : []), history(), blockProtection, EditorView.clipboardOutputFilter.of(visibleCopiedText), mergeFirstInsert,
    drawSelection(), highlightActiveLine(), markdown({ codeLanguages: codeLanguage }), tasks, features, noteComments, noteHeadings,
    syntaxHighlighting(defaultHighlightStyle), syntaxHighlighting(markdownColors), syntaxHighlighting(classHighlighter), EditorView.lineWrapping, scrollOff,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    saveOnChange
  ] });
  const position = taskContentPosition(initial, initial.selection.main.head);
  return position === initial.selection.main.head ? initial : initial.update({ selection: { anchor: position } }).state;
}

// Show note `id`, keeping the outgoing note's editor state for its undo history.
export function changeEditor(id) {
  closeBlockMenu(); closeLanguageMenu();
  if (app.editor) { app.editorStates.set(app.state.selected, app.editor.state); app.editor.destroy(); }
  app.state.selected = id;
  app.editor = new EditorView({ parent: $('editor'), state: app.editorStates.get(id) || makeState(current().content) });
  bindVimMode();
  refreshNav(); refreshInsights(); app.editor.focus();
}

function bindVimMode() {
  $('mode').hidden = !app.vimEnabled;
  const cm = getCM(app.editor);
  if (!app.vimEnabled || !cm) {
    if (nativeHandler()) window.prompt('quicknote-input-mode', 'insert');
    return;
  }
  cm.on('vim-mode-change', event => {
    if (event.mode === 'insert') app.mergeFirstInsert = !!app.keyStartDoc && app.editor.state.doc !== app.keyStartDoc;
    else app.mergeFirstInsert = false;
    const mode = event.mode || 'normal';
    $('mode').textContent = String(mode).toUpperCase();
    // Wait for the native input source switch before the next keystroke can
    // reach the IME; a queued message can race with fast Vim/pinyin input.
    if (nativeHandler()) window.prompt('quicknote-input-mode', mode);
  });
  $('mode').textContent = 'NORMAL';
  if (nativeHandler()) window.prompt('quicknote-input-mode', 'normal');
}

export function setVimEnabled(value) {
  const enabled = !!value;
  if (enabled === app.vimEnabled) return;
  app.vimEnabled = enabled; app.mergeFirstInsert = false;
  closeBlockMenu(); closeLanguageMenu();
  for (const [id, cached] of app.editorStates) app.editorStates.set(id, cached.update({ effects: vimCompartment.reconfigure(enabled ? vim() : []) }).state);
  if (app.editor) { app.editor.dispatch({ effects: vimCompartment.reconfigure(enabled ? vim() : []) }); bindVimMode(); }
}

// The summary line for feature blocks, shown under the editor.
export function refreshInsights() {
  if (!app.editor) return;
  const info = analyzeCurrent(app.editor.state.doc.toString());
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
