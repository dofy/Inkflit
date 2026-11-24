// Entry point for the note window (bundled to web/dist/editor.js).
//
//   app.js            shared state and native helpers
//   persistence.js    saving and save results
//   editor-view.js    the CodeMirror editor for the selected note, Vim mode
//   toolbar.js        page counter, creation date, toolbar regions
//   notes.js          create, select and move between notes
//   delete-notices.js deleting notes and the 12-second undo notices
//   palettes.js       note search and the command palette
//   commands.js       shared commands and keyboard bindings
//   keys.js           keyboard event routing and editor input
//   automation.js     note operations for MCP and inkflit:// links
//   bridge.js         the functions the native app calls on window
import { lang } from './i18n.js';
import { app, $, nativeHandler } from './app.js';
import { watchToolbarRegions } from './toolbar.js';
import { initBlockMenu } from './block-menu.js';
import { initLanguageMenu } from './language-menu.js';
import { commandShortcutLabel, runCommand } from './commands.js';
import { installKeys } from './keys.js';
import { installBridge } from './bridge.js';

watchToolbarRegions();
initBlockMenu($('block-menu'), () => app.editor, commandShortcutLabel('delete-block'));
initLanguageMenu($('language-menu'), () => app.editor);

$('new').onclick = () => runCommand('new-note');
$('delete').onclick = () => runCommand('delete-note');
$('previous').onclick = () => runCommand('previous-note');
$('next').onclick = () => runCommand('next-note');
$('search').onclick = () => runCommand('find-note');
$('pin-window').onclick = () => {
  if (runCommand('toggle-window-pin')) app.editor.focus();
};

installKeys();
installBridge();
window.setLanguage(lang());

// In a plain browser (tests, previews) notes live in localStorage.
if (!nativeHandler()) {
  const saved = localStorage.getItem('inkflit-test');
  window.loadNotesBase64(saved ? btoa(unescape(encodeURIComponent(saved))) : null);
}
