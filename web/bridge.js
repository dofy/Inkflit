import { t, setLanguage, lang } from './i18n.js';
import { app, $, newNote, resolveNativeRequest, windowPinModes } from './app.js';
import { saveResult, snapshotForFlush } from './persistence.js';
import { loadNoteSnapshot, setVimEnabled, refreshBlockResults, prepareToHide } from './editor-view.js';
import { applyToolbarLanguage, updateWindowPinButton } from './toolbar.js';
import { addGuideNotes, createNote, select } from './notes.js';
import { updateDeleteNotices } from './delete-notices.js';
import { applyPaletteLanguage, commandPalette, openCommands, openSearch, searchPalette, setCommandHistory, setCommandState } from './palettes.js';
import { notesOperation } from './automation.js';
import { setUserSnippets, setSnippetPreferences, settingsSnippetControls, settingsSnippetPlaceholders } from './snippet-completion.js';
import { closeBlockMenu } from './block-menu.js';
import { closeLanguageMenu } from './language-menu.js';
import { normalizeIndentation } from './code-editing.js';
import { setCodeLineNumbers } from './code-line-numbers.js';
import { applyCodeTheme, codeThemes } from './code-themes.js';
import { applyUIAppearance } from './ui-themes.js';
import { clearEscapeHint, setVimDoubleEscape } from './keys.js';
import { showToast } from './toast.js';

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

let codeTheme = codeThemes[0].id, uiTheme = 'orange', opacity = 100, colorScheme = 'system';
const systemColorScheme = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
function applyColors() {
  const root = document.documentElement;
  const dark = colorScheme === 'dark' || (colorScheme === 'system' && systemColorScheme?.matches === true);
  applyUIAppearance(uiTheme, opacity, root, dark);
  applyCodeTheme(codeTheme, root, dark);
}
function watchColorScheme() {
  applyColors();
  systemColorScheme?.addEventListener('change', () => { if (colorScheme === 'system') applyColors(); });
}

// Load the notes, or start with one empty note when there are none yet.
function loadNotesBase64(value) {
  try {
    const loaded = value ? JSON.parse(decodeBase64(value)) : null;
    if (loaded && (!Array.isArray(loaded.notes) || !loaded.notes.length || !loaded.notes.every(n => typeof n.id === 'string' && typeof n.content === 'string' && typeof n.updated === 'string') || !loaded.notes.some(n => n.id === loaded.selected))) throw new Error(t('error.invalidNotesFile'));
    if (loaded) {
      delete loaded.timer;
      loadNoteSnapshot(loaded);
    } else {
      const note = newNote();
      loadNoteSnapshot({ notes: [note], selected: note.id });
    }
    $('save').textContent = ''; $('save').title = ''; $('save').className = '';
  } catch (error) { $('save').className = 'error'; $('save').textContent = t('error.readFailed') + error.message; $('save').title = $('save').textContent; }
}

export function installBridge() {
  Object.assign(window, {
    showToast,
    // Notes and saving
    loadNotesBase64,
    saveResult,
    snapshotForFlush,
    exportNotesJSON: () => app.state ? JSON.stringify(app.state) : null,
    inkflitNotesOperation: notesOperation,
    inkflitSelectNote: (id, reveal = false) => {
      if (!app.state?.notes.some(note => note.id === id)) return false;
      if (reveal) {
        commandPalette.close(); searchPalette.close(); closeBlockMenu(); closeLanguageMenu();
      }
      select(id);
      return true;
    },
    // A note restored from backups or the Trash goes last.
    restoreNoteBase64: value => {
      if (!app.state) throw new Error('No note state');
      createNote(decodeBase64(value));
    },
    // Regenerated guide notes go first and open the welcome note.
    addOnboardingNotesBase64: value => {
      if (!app.state) throw new Error('No note state');
      const contents = JSON.parse(decodeBase64(value));
      if (!Array.isArray(contents) || !contents.length || !contents.every(text => typeof text === 'string' && text.trim())) throw new Error('Invalid guide notes');
      return addGuideNotes(contents);
    },
    // Window and panels
    focusEditor: () => { app.editor?.focus(); },
    prepareToHide,
    setWindowPinMode: mode => {
      if (!windowPinModes.includes(mode)) return;
      app.windowPinMode = mode;
      clearEscapeHint();
      updateWindowPinButton();
      if (commandPalette.open) commandPalette.render();
    },
    openCommands,
    openNoteSearch: openSearch,
    setCommandHistory,
    setCommandState,
    setUserSnippets,
    setSnippetPreferences,
    snippetControls: settingsSnippetControls,
    // Settings → Snippets: built-in rows as placeholders, in the app language.
    snippetPlaceholders: settingsSnippetPlaceholders,
    resolveNativeRequest,
    setShortcutLabel: label => { $('shortcut').textContent = label; },
    // Settings
    setLanguage: applyLanguage,
    setVimEnabled,
    setVimDoubleEscape,
    setCodeIndentation: value => { app.codeIndentation = normalizeIndentation(value); },
    setCodeLineNumbers,
    setCodeTheme: value => { codeTheme = value; applyColors(); },
    setEditorTypography: (family, size) => {
      const style = document.documentElement.style;
      const font = family ? `${CSS.escape(family)}, monospace` : '';
      const fontSize = `${size}px`;
      if (style.getPropertyValue('--editor-font-family') === font && style.getPropertyValue('--editor-font-size') === fontSize) return;
      if (font) style.setProperty('--editor-font-family', font);
      else style.removeProperty('--editor-font-family');
      style.setProperty('--editor-font-size', fontSize);
      app.editor?.requestMeasure();
    },
    setUIAppearance: (theme, value, scheme = colorScheme, paper, textureScale) => {
      uiTheme = theme; opacity = value; colorScheme = scheme; applyColors();
      const root = document.documentElement;
      if (paper !== undefined && root.dataset.notePaper !== paper) root.dataset.notePaper = paper;
      if (Number.isFinite(textureScale)) root.style.setProperty('--note-texture-scale', String(textureScale));
    },
  });
  watchColorScheme();
}
