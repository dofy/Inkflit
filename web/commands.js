import { Vim, getCM } from '@replit/codemirror-vim';
import { toggleLineComment } from '@codemirror/commands';
import { app, nativeCommand, nativeHandler } from './app.js';
import { t } from './i18n.js';
import { selectAt, createNote, navigate, selectFirst, selectLast } from './notes.js';
import { deleteNote, hasDeleteNotices, restoreLastDeleted } from './delete-notices.js';
import { formatCurrentNote } from './note-format.js';
import { codeThemes } from './code-themes.js';
import { blockMenuOpen, currentBlockScope, openInsertBlockMenu, canInsertBlock, deleteCurrentBlock, openCurrentBlockMenu, planAdjacentBlockLine, planAdjacentTextLine } from './block-menu.js';
import { closeLanguageMenu, languageMenuOpen, openCurrentLanguageMenu, currentLanguageScope } from './language-menu.js';
import { scopeAt } from './features.js';
import { commentChanges, blockCodeCommentChanges, isCodeAt, selectedLines } from './comments.js';
import { planTaskToggle } from './tasks.js';

let commandState = {};
export function updateCommandState(value) { commandState = value && typeof value === 'object' ? value : {}; }
let paletteActions;
export function bindPaletteActions(actions) { paletteActions = actions; }

const note = 'note.notes', edit = 'app.edit', setting = 'settings.title', windowGroup = 'app.window';
const focused = editor => editor.hasFocus;
const editorMenusClosed = () => !blockMenuOpen() && !languageMenuOpen();
const focusedWithoutMenus = editor => focused(editor) && editorMenusClosed();
const editorCommands = [
  { id: 'new-note', label: 'note.new', group: note, aliases: ['new create note'], key: 'n', repeat: true, run: () => createNote() },
  { id: 'find-note', label: 'palette.searchNotes', group: note, aliases: ['search find note'],
    key: 'f', shift: true, phase: 'palette', run: () => paletteActions?.toggleSearch() },
  { id: 'previous-note', label: 'note.previous', group: note, aliases: ['previous note'], key: '[', repeat: true, run: () => navigate(-1) },
  { id: 'next-note', label: 'note.next', group: note, aliases: ['next note'], key: ']', repeat: true, run: () => navigate(1) },
  { id: 'first-note', label: 'note.first', group: note, aliases: ['first note top start'], key: '[', code: 'BracketLeft', shift: true, run: () => selectFirst() },
  { id: 'restore-last-note', label: 'note.restoreLastDeleted', group: note, aliases: ['restore undo deleted note'], key: 'u', phase: 'early', when: () => hasDeleteNotices(), run: () => restoreLastDeleted() },
  { id: 'last-note', label: 'note.last', group: note, aliases: ['last note bottom end'], key: ']', code: 'BracketRight', shift: true, run: () => selectLast() },
  { id: 'format-note', label: 'palette.formatNote', group: note, aliases: ['format note code math beautify'], run: () => formatCurrentNote() },
  { id: 'delete-note', label: 'note.delete', group: note, aliases: ['delete note trash'], key: 'd', repeat: true, run: () => deleteNote() },
  { id: 'insert-block', label: 'palette.insertBlock', group: edit, aliases: ['insert new feature block'], when: canInsertBlock, run: openInsertBlockMenu },
  { id: 'change-block', label: 'palette.changeBlockType', group: edit, aliases: ['change feature block type convert'], key: 'k', phase: 'before-menu', keyboardWhen: focused, when: editor => !!currentBlockScope(editor.state), run: editor => {
    if (!openCurrentBlockMenu(editor)) return false;
    closeLanguageMenu();
    return true;
  } },
  { id: 'delete-block', label: 'palette.deleteBlock', group: edit, aliases: ['delete current feature block', '删除块', '刪除區塊'], key: 'd', shift: true, phase: 'before-menu', capture: true,
    when: editor => !!currentBlockScope(editor.state), run: deleteCurrentBlock },
  { id: 'code-language', label: 'palette.chooseCodeLanguage', group: edit, aliases: ['choose code block language', '代码语言', '程式碼語言'], key: 'l', phase: 'before-menu', closePalette: true,
    keyboardWhen: focused, when: editor => !!currentLanguageScope(editor.state), run: openCurrentLanguageMenu },
  { id: 'copy-code-block', label: 'palette.copyCodeBlock', group: edit, aliases: ['copy whole code block'], key: 'c', repeat: true,
    keyboardWhen: editor => editor.state.selection.main.empty, when: editor => codeScope(editor)?.mode === 'code', run: copyCodeBlock },
  { id: 'toggle-task', label: 'palette.toggleTask', group: edit, aliases: ['toggle checklist markdown task checkbox'], key: 'enter', phase: 'after-menu',
    keyboardWhen: focusedWithoutMenus, when: editor => !!planTaskToggle(editor.state), run: editor => {
      const plan = planTaskToggle(editor.state);
      if (!plan) return false;
      editor.dispatch(plan);
    } },
  { id: 'toggle-comment', label: 'palette.toggleComment', group: edit, aliases: ['comment uncomment lines'], key: '/', repeat: true, run: toggleComments },
  ...[false, true].map(above => ({
    id: above ? 'insert-line-above' : 'insert-line-below', label: above ? 'palette.insertLineAbove' : 'palette.insertLineBelow', group: edit,
    aliases: [above ? 'insert blank line above' : 'insert blank line below'], key: 'o', shift: above, phase: 'before-menu', closePalette: !above,
    keyboardWhen: focusedWithoutMenus, when: editor => !!adjacentLine(editor, above), run: editor => insertAdjacentLine(editor, above)
  })),
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `note-position-${index + 1}`, key: String(index + 1), repeat: true, run: () => selectAt(index + 1)
  })),
  { id: 'open-command-palette', phase: 'palette', key: 'p', shift: true, run: () => paletteActions?.toggleCommands() }
];

const native = (id, label, aliases, group = setting, nativeShortcut = false) =>
  ({ id, label, aliases, group, nativeShortcut, run: () => nativeCommand(id) });
const nativeCommands = [
  { ...native('hide-window', 'palette.hideWindow', ['hide close window', '关闭窗口 立即收起窗口', '關閉視窗 立即收起視窗'], windowGroup, true), when: () => !app.windowPinned, run: () => {
    if (nativeHandler()) nativeCommand('hide-window');
    else window.inkflitHideRequested = (window.inkflitHideRequested || 0) + 1;
  } },
  { id: 'toggle-window-pin', label: () => app.windowPinned ? 'palette.unpinWindow' : 'palette.pinWindow',
    aliases: ['toggle pin unpin keep window open', '防止窗口收起 图钉', '防止視窗收起 圖釘', 'ウインドウを開いたまま'], group: windowGroup,
    run: editor => {
      const pinned = !app.windowPinned;
      window.setWindowPinned(pinned);
      nativeCommand('pin-window', pinned ? 'on' : 'off');
      editor.focus();
    } },
  native('quit', 'app.quit', ['quit exit inkflit'], windowGroup, true),
  native('settings', 'palette.openSettings', ['settings preferences'], setting, true),
  native('toggle-vim', () => app.vimEnabled ? 'palette.disableVim' : 'palette.enableVim', ['vim mode toggle']),
  native('record-shortcut', 'palette.recordShortcut', ['record change global keyboard shortcut']),
  native('clear-shortcut', 'settings.clearGlobalShortcut', ['clear remove global keyboard shortcut']),
  native('reset-shortcut', 'palette.resetShortcut', ['reset restore default global keyboard shortcut']),
  native('login-settings', 'palette.openLoginSettings', ['open macos login items settings']),
  native('choose-notes-folder', 'settings.chooseNotesFolder', ['change choose notes storage directory', '更换笔记文件夹', '變更筆記資料夾']),
  native('restore-version', 'settings.restorePreviousVersion', ['restore previous backup history version', '恢复历史版本', '還原歷史版本']),
  native('restore-trash', 'settings.restoreDeletedNote', ['restore deleted note from trash', '从回收站恢复', '從回收站還原']),
  native('rebuild-index', 'settings.rebuildIndex', ['rebuild notes index recovery']),
  native('snippet-add', 'settings.snippetAdd', ['add create new snippet']),
  native('snippet-remove', 'settings.snippetRemove', ['delete remove snippet']),
  native('snippet-placeholder', 'settings.insertPlaceholder', ['insert snippet placeholder'])
];

function adjacentLine(editor, above) {
  return planAdjacentBlockLine(editor.state, above) ?? planAdjacentTextLine(editor.state, above);
}

function insertAdjacentLine(editor, above) {
  let plan = adjacentLine(editor, above);
  if (!plan) return false;
  const cm = getCM(editor);
  if (cm?.state?.vim?.visualMode) {
    Vim.handleKey(cm, '<Esc>', 'user');
    plan = adjacentLine(editor, above);
  }
  if (!plan) return false;
  editor.dispatch(plan);
  if (cm && !cm.state.vim?.insertMode) Vim.handleKey(cm, 'i', 'user');
  editor.focus();
}

function codeScope(editor) {
  const { doc, selection } = editor.state;
  return scopeAt(doc, doc.lineAt(selection.main.head).number);
}

function copyCodeBlock(editor) {
  const { doc } = editor.state, scope = codeScope(editor);
  if (scope?.mode !== 'code') return false;
  const from = scope.start < doc.lines ? doc.line(scope.start + 1).from : doc.length;
  const to = doc.line(Math.min(doc.lines, scope.last)).to;
  const content = doc.sliceString(from, Math.max(from, to));
  const handler = nativeHandler();
  if (handler) handler.postMessage({ type: 'copyCode', content });
  else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(content).catch(() => {});
  else return false;
  return true;
}

function toggleComments(editor) {
  const lines = selectedLines(editor.state);
  const customCode = blockCodeCommentChanges(editor.state);
  if (customCode) {
    if (customCode.length) editor.dispatch({ changes: customCode, userEvent: 'input.comment' });
    return;
  }
  const inCode = lines.length && lines.every(line => isCodeAt(editor.state, line.from));
  if (!inCode || !toggleLineComment(editor)) {
    const changes = commentChanges(editor.state, { includeCode: !!inCode });
    if (changes.length) editor.dispatch({ changes, userEvent: 'input.comment' });
  }
}

// Options with several values open a second level of the palette;
// `current` marks the value in commandState.
const choices = (action, pairs) => () => pairs.map(([value, label]) => ({ label: t(label), aliases: [value], current: commandState[action] === value, run: () => nativeCommand(action, value) }));
// Presets plus the current value when it is not one of them.
const withCurrent = (values, action) => { const value = Number(commandState[action]); return Number.isInteger(value) && !values.includes(value) ? [...values, value].sort((a, b) => b - a) : values; };
const percent = (action, values, min, max) => Object.assign(
  () => withCurrent(values, action).map(value => ({ label: `${value}%`, aliases: [String(value)], current: commandState[action] === String(value), run: () => nativeCommand(action, String(value)) })),
  { typed: query => { const value = Number(query.trim().replace(/%$/, '')); return Number.isInteger(value) && value >= min && value <= max ? { label: `${value}%`, run: () => nativeCommand(action, String(value)) } : null; } }
);
const versions = count => t('palette.keepVersions').replace('%d', String(count));
const backups = Object.assign(() => [
  { label: t('settings.off'), aliases: ['off'], current: commandState.backup === 'off', run: () => nativeCommand('backup', 'off') },
  { label: t('settings.backupUnlimited'), aliases: ['unlimited'], current: commandState.backup === 'unlimited', run: () => nativeCommand('backup', 'unlimited') },
  ...withCurrent([10, 20, 50, 100], 'backup').sort((a, b) => a - b).map(count => ({ label: versions(count), aliases: [String(count)], current: commandState.backup === String(count), run: () => nativeCommand('backup', String(count)) }))
], { typed: query => { const count = Number(query.trim()); return Number.isInteger(count) && count >= 1 && count <= 1_000_000 ? { label: versions(count), run: () => nativeCommand('backup', String(count)) } : null; } });

const settingsCommands = [
  { id: 'vim-double-escape', label: 'settings.vimDoubleEscape', group: setting, aliases: ['vim escape esc double single hide window', '两次 Esc 退出窗口 关闭窗口', '兩次 Esc 關閉視窗'], children: choices('vim-double-escape', [['on', 'palette.on'], ['off', 'settings.off']]) },
  { id: 'color-scheme', label: 'settings.colorScheme', group: setting, aliases: ['appearance color scheme dark light system'], children: choices('color-scheme', [['system', 'settings.appearanceSystem'], ['light', 'settings.appearanceLight'], ['dark', 'settings.appearanceDark']]) },
  { id: 'ui-theme', label: 'settings.accentColor', group: setting, aliases: ['appearance accent theme color'], children: choices('ui-theme', [['orange', 'settings.themeWarmOrange'], ['blue', 'settings.themeOceanBlue'], ['green', 'settings.themeSage']]) },
  { id: 'code-theme', label: 'settings.codeColors', group: setting, aliases: ['code syntax theme'], children: choices('code-theme', codeThemes.map(({ id, title }) => [id, title])) },
  { id: 'indent', label: 'settings.codeIndentation', group: setting, aliases: ['code indentation indent'], children: choices('indent', [['spaces2', 'settings.indentTwoSpaces'], ['spaces4', 'settings.indentFourSpaces'], ['tabs', 'Tab']]) },
  { id: 'language', label: 'settings.language', group: setting, aliases: ['language locale'], children: choices('language', [['system', 'settings.languageSystem'], ['en', 'English'], ['zh-Hans', '简体中文'], ['zh-Hant', '繁體中文'], ['ja', '日本語']]) },
  { id: 'reset-window-size', label: 'settings.resetWindowSize', group: setting, aliases: ['restore reset default window size', '恢复窗口预设大小 恢复默认窗口大小', '恢復視窗預設大小'], run: () => nativeCommand('reset-window-size') },
  { id: 'opacity', label: 'settings.windowOpacity', group: setting, aliases: ['window opacity transparency'], children: percent('opacity', [100, 90, 80, 70, 60, 50], 50, 100) },
  { id: 'blur', label: 'settings.backgroundBlur', group: setting, aliases: ['background blur'], children: percent('blur', [0, 20, 40, 60, 80, 100], 0, 100) },
  { id: 'backup', label: 'settings.automaticBackups', group: setting, aliases: ['automatic backup versions'], children: backups },
  { id: 'login', label: 'settings.launchAtLogin', group: setting, aliases: ['launch at login startup'], children: choices('login', [['on', 'palette.on'], ['off', 'settings.off']]) },
  { id: 'snippets', label: 'palette.manageSnippets', group: setting, aliases: ['snippets text replacement @'], run: () => nativeCommand('snippets') },
  { id: 'onboarding', label: 'settings.restoreGuideNotes', group: setting, aliases: ['restore guide notes onboarding'], run: () => nativeCommand('onboarding') },
  { id: 'help', label: 'settings.openHelp', group: setting, aliases: ['help guide documentation'], run: () => nativeCommand('help') }
];

const definitions = [...editorCommands, ...nativeCommands, ...settingsCommands];
const byId = new Map(definitions.map(command => [command.id, command]));
const bindingKey = (phase, shift, key) => `${phase}:${shift ? 'shift' : 'plain'}:${key}`;
const bindings = new Map(editorCommands.filter(command => command.key).map(command => [
  bindingKey(command.phase || 'main', command.shift, command.code || command.key), command
]));

// Prefer an explicit physical key when a layout changes the shifted character.
export function commandShortcut(event, phase) {
  if (!event.metaKey || event.ctrlKey || event.altKey) return null;
  return bindings.get(bindingKey(phase, event.shiftKey, event.code))
    ?? bindings.get(bindingKey(phase, event.shiftKey, event.key.toLowerCase())) ?? null;
}

function shortcutLabel(command) {
  if (command.nativeShortcut) return commandState[`${command.id}-shortcut`] || '';
  if (!command.key) return '';
  return `⌘${command.shift ? '⇧' : ''}${command.key === 'enter' ? '↩' : command.key.toUpperCase()}`;
}
export function commandShortcutLabel(id) { return shortcutLabel(byId.get(id)); }

export function runCommand(command) {
  if (typeof command === 'string') command = byId.get(command);
  const editor = app.editor;
  if (!editor || !command?.run || (command.when && !command.when(editor))) return false;
  return command.run(editor) !== false;
}

export function runShortcut(event, phase) {
  const command = commandShortcut(event, phase), editor = app.editor;
  if (!command || !editor || (command.keyboardWhen && !command.keyboardWhen(editor))) return false;
  if (command.when && !command.when(editor) && !command.capture) return false;
  return (event.repeat && !command.repeat) || command.run(editor) !== false || command.capture === true;
}

export function availableCommands() {
  const editor = app.editor;
  return definitions.filter(command => command.label && (!command.when || (editor && command.when(editor))))
    .map(command => ({ ...command, label: t(typeof command.label === 'function' ? command.label() : command.label),
      group: t(command.group), shortcut: shortcutLabel(command) }));
}
