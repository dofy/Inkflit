import { t, setLanguage, lang } from './i18n.js';
import { app, $, newNote } from './app.js';
import { persist, saveResult, snapshotForFlush } from './persistence.js';
import { changeEditor, setVimEnabled, refreshBlockResults } from './editor-view.js';
import { applyToolbarLanguage } from './toolbar.js';
import { select } from './notes.js';
import { updateDeleteNotices } from './delete-notices.js';
import { applyPaletteLanguage, openCommands, openSearch, setCommandState } from './palettes.js';
import { notesOperation } from './automation.js';
import { closeBlockMenu } from './block-menu.js';
import { closeLanguageMenu } from './language-menu.js';
import { normalizeIndentation } from './code-editing.js';
import { applyCodeTheme } from './code-themes.js';
import { applyUIAppearance } from './ui-themes.js';

// Everything the native app calls on `window`, in one place.

const decodeBase64 = value => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)));

function applyLanguage(value) {
  setLanguage(value); document.documentElement.lang = lang();
  applyToolbarLanguage();
  $('block-menu').setAttribute('aria-label', t('block.menuLabel')); $('language-menu').setAttribute('aria-label', t('editor.codeLanguage'));
  applyPaletteLanguage();
  document.querySelectorAll('.task-checkbox').forEach(box => box.setAttribute('aria-label', t(box.getAttribute('aria-checked') === 'true' ? 'editor.markIncomplete' : 'editor.markComplete')));
  updateDeleteNotices();
  if (app.editor) { closeBlockMenu(); closeLanguageMenu(); refreshBlockResults(); }
}

// Appearance is reapplied when macOS switches between light and dark.
let codeTheme = 'amber', uiTheme = 'orange', opacity = 100;
function watchColorScheme() {
  applyCodeTheme(codeTheme); applyUIAppearance(uiTheme, opacity);
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => { applyUIAppearance(uiTheme, opacity); applyCodeTheme(codeTheme); });
}

// Load the notes, or start with one empty note when there are none yet.
function loadNotesBase64(value) {
  try {
    const loaded = value ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)))) : null;
    if (loaded && (!Array.isArray(loaded.notes) || !loaded.notes.length || !loaded.notes.every(n => typeof n.id === 'string' && typeof n.content === 'string' && typeof n.updated === 'string') || !loaded.notes.some(n => n.id === loaded.selected))) throw new Error(t('error.invalidNotesFile'));
    if (loaded) { delete loaded.timer; app.state = loaded; } else { const note = newNote(); app.state = { notes: [note], selected: note.id }; }
    changeEditor(app.state.selected); $('save').textContent = ''; $('save').title = ''; $('save').className = '';
  } catch (error) { $('save').className = 'error'; $('save').textContent = t('error.readFailed') + error.message; $('save').title = $('save').textContent; }
}

export function installBridge() {
  Object.assign(window, {
    // Notes and saving
    loadNotesBase64,
    saveResult,
    snapshotForFlush,
    exportNotesJSON: () => app.state ? JSON.stringify(app.state) : null,
    inkflitNotesOperation: notesOperation,
    inkflitSelectNote: id => { if (app.state?.notes.some(note => note.id === id)) { select(id); return true; } return false; },
    // A note restored from backups or the Trash goes last.
    restoreNoteBase64: value => {
      if (!app.state) throw new Error('No note state');
      const note = newNote(); note.content = decodeBase64(value); app.state.notes.push(note); changeEditor(note.id); persist(true);
    },
    // Regenerated guide notes go first and open the welcome note.
    addOnboardingNotesBase64: value => {
      if (!app.state) throw new Error('No note state');
      const contents = JSON.parse(decodeBase64(value));
      if (!Array.isArray(contents) || !contents.length || !contents.every(text => typeof text === 'string' && text.trim())) throw new Error('Invalid guide notes');
      const notes = contents.map(content => ({ ...newNote(), content }));
      app.state.notes.unshift(...notes); changeEditor(notes[0].id); persist(true);
      return notes.length;
    },
    // Window and panels
    focusEditor: () => { app.editor?.focus(); },
    openCommands,
    openNoteSearch: openSearch,
    setCommandState,
    setShortcutLabel: label => { $('shortcut').textContent = label; },
    // Settings
    setLanguage: applyLanguage,
    setVimEnabled,
    setCodeIndentation: value => { app.codeIndentation = normalizeIndentation(value); },
    setCodeTheme: value => { codeTheme = value; applyCodeTheme(value); },
    setUIAppearance: (theme, value) => { uiTheme = theme; opacity = value; applyUIAppearance(theme, value); },
  });
  watchColorScheme();
}
