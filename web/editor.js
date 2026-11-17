// Entry point for the note window (bundled to web/dist/editor.js).
//
//   app.js            shared state and native helpers
//   persistence.js    saving and save results
//   editor-view.js    the CodeMirror editor for the selected note, Vim mode
//   toolbar.js        page counter, creation date, toolbar regions
//   notes.js          create, select and move between notes
//   delete-notices.js deleting notes and the 12-second undo notices
//   palettes.js       note search and the command palette
//   keys.js           every keyboard shortcut
//   automation.js     note operations for MCP and inkflit:// links
//   bridge.js         the functions the native app calls on window
import { lang } from './i18n.js';
import { app, $, nativeHandler } from './app.js';
import { watchToolbarRegions } from './toolbar.js';
import { initBlockMenu } from './block-menu.js';
import { initLanguageMenu } from './language-menu.js';
import { createNote, navigate } from './notes.js';
import { deleteNote } from './delete-notices.js';
import { searchPalette, openSearch } from './palettes.js';
import { installKeys } from './keys.js';
import { installBridge } from './bridge.js';

watchToolbarRegions();
initBlockMenu($('block-menu'), () => app.editor);
initLanguageMenu($('language-menu'), () => app.editor);

$('new').onclick = createNote;
$('delete').onclick = deleteNote;
$('previous').onclick = () => navigate(-1);
$('next').onclick = () => navigate(1);
$('search').onclick = () => { if (searchPalette.open) searchPalette.close(); else openSearch(); };

installKeys();
installBridge();
window.setLanguage(lang());

// In a plain browser (tests, previews) notes live in localStorage.
if (!nativeHandler()) {
  const saved = localStorage.getItem('inkflit-test');
  window.loadNotesBase64(saved ? btoa(unescape(encodeURIComponent(saved))) : null);
}
