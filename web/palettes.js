import { t } from './i18n.js';
import { app, $, nativeCommand } from './app.js';
import { createPalette } from './palette.js';
import { filterCommands } from './command-palette.js';
import { searchNotes, notePreview } from './note-search.js';
import { closeBlockMenu } from './block-menu.js';
import { closeLanguageMenu } from './language-menu.js';
import { select, createNote, navigate, selectFirst, selectLast } from './notes.js';
import { deleteNote, hasDeleteNotices, restoreLastDeleted } from './delete-notices.js';
import { formatCurrentNote } from './note-format.js';
import { codeThemes } from './code-themes.js';

// Note search (⌘⇧F) and the command palette (⌘⇧P) share one palette component.

export const searchPalette = createPalette({
  id: 'search',
  rows: query => query.trim()
    ? searchNotes(app.state?.notes || [], query)
    : (app.state?.notes || []).map((note, index) => ({ id: note.id, index: index + 1, at: 0, length: 0, snippet: notePreview(note.content) || t('note.empty') })),
  renderRow: (row, result) => {
    row.classList.add('search-result');
    const number = document.createElement('span'); number.className = 'palette-row-index'; number.textContent = String(result.index);
    const snippet = document.createElement('span'); snippet.className = 'palette-row-title'; snippet.textContent = result.snippet;
    row.append(number, snippet);
  },
  empty: query => t(query.trim() ? 'palette.noMatchingNotes' : 'palette.typeToSearch'),
  choose: result => {
    select(result.id);
    const doc = app.editor.state.doc;
    const from = Math.min(result.at, doc.length), to = Math.min(from + result.length, doc.length);
    app.editor.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true }); app.editor.focus();
  },
  closed: () => app.editor?.focus()
});

export function openSearch(query = '') { if (!app.state) return; closeBlockMenu(); closeLanguageMenu(); commandPalette.close(); searchPalette.show(query); }

// Current settings from the native side, keyed by the same action names the
// commands send; it answers a 'state' request each time the palette opens.
let commandState = {};
export function setCommandState(value) { commandState = value && typeof value === 'object' ? value : {}; if (commandPalette.open) commandPalette.render(); }

function availableCommands() {
  const note = t('note.notes'), setting = t('settings.title');
  const commands = [
    { label: t('note.new'), group: note, shortcut: '⌘N', aliases: ['new create note'], run: createNote },
    { label: t('palette.searchNotes'), group: note, shortcut: '⌘⇧F', aliases: ['search find note'], run: () => openSearch() },
    { label: t('note.previous'), group: note, shortcut: '⌘[', aliases: ['previous note'], run: () => navigate(-1) },
    { label: t('note.next'), group: note, shortcut: '⌘]', aliases: ['next note'], run: () => navigate(1) },
    { label: t('note.first'), group: note, shortcut: '⌘⇧[', aliases: ['first note top start'], run: selectFirst },
    { label: t('note.last'), group: note, shortcut: '⌘⇧]', aliases: ['last note bottom end'], run: selectLast },
    { label: t('palette.formatNote'), group: note, aliases: ['format note code math beautify'], run: formatCurrentNote },
    { label: t('note.delete'), group: note, shortcut: '⌘D', aliases: ['delete note trash'], run: deleteNote },
    { label: t('palette.openSettings'), group: setting, shortcut: '⌘,', aliases: ['settings preferences'], run: () => nativeCommand('settings') },
    { label: t(app.vimEnabled ? 'palette.disableVim' : 'palette.enableVim'), group: setting, aliases: ['vim mode toggle'], run: () => nativeCommand('toggle-vim') }
  ];
  if (hasDeleteNotices()) commands.splice(5, 0, { label: t('note.restoreLastDeleted'), group: note, shortcut: '⌘U', aliases: ['restore undo deleted note'], run: restoreLastDeleted });

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

  commands.push(
    { label: t('settings.colorScheme'), group: setting, aliases: ['appearance color scheme dark light system'], children: choices('color-scheme', [['system', 'settings.appearanceSystem'], ['light', 'settings.appearanceLight'], ['dark', 'settings.appearanceDark']]) },
    { label: t('settings.accentColor'), group: setting, aliases: ['appearance accent theme color'], children: choices('ui-theme', [['orange', 'settings.themeWarmOrange'], ['blue', 'settings.themeOceanBlue'], ['green', 'settings.themeSage']]) },
    { label: t('settings.codeColors'), group: setting, aliases: ['code syntax theme'], children: choices('code-theme', codeThemes.map(({ id, title }) => [id, title])) },
    { label: t('settings.codeIndentation'), group: setting, aliases: ['code indentation indent'], children: choices('indent', [['spaces2', 'settings.indentTwoSpaces'], ['spaces4', 'settings.indentFourSpaces'], ['tabs', 'Tab']]) },
    { label: t('settings.language'), group: setting, aliases: ['language locale'], children: choices('language', [['system', 'settings.languageSystem'], ['en', 'English'], ['zh-Hans', '简体中文'], ['zh-Hant', '繁體中文'], ['ja', '日本語']]) },
    { label: t('settings.windowOpacity'), group: setting, aliases: ['window opacity transparency'], children: percent('opacity', [100, 90, 80, 70, 60, 50], 50, 100) },
    { label: t('settings.backgroundBlur'), group: setting, aliases: ['background blur'], children: percent('blur', [0, 20, 40, 60, 80, 100], 0, 100) },
    { label: t('settings.automaticBackups'), group: setting, aliases: ['automatic backup versions'], children: backups },
    { label: t('settings.launchAtLogin'), group: setting, aliases: ['launch at login startup'], children: choices('login', [['on', 'palette.on'], ['off', 'settings.off']]) },
    { label: t('palette.manageSnippets'), group: setting, aliases: ['snippets text replacement @'], run: () => nativeCommand('snippets') },
    { label: t('settings.restoreGuideNotes'), group: setting, aliases: ['restore guide notes onboarding'], run: () => nativeCommand('onboarding') },
    { label: t('settings.openHelp'), group: setting, aliases: ['help guide documentation'], run: () => nativeCommand('help') }
  );
  return commands;
}

// First level: the commands, or while typing also every second-level option
// ("Language: English") so a value can be reached in one step.
function commandRows(query, parent) {
  if (parent) {
    const options = parent.children(), typed = parent.children.typed?.(query);
    const matches = filterCommands(options, query);
    return typed && !matches.some(option => option.label === typed.label) ? [typed, ...matches] : matches;
  }
  const commands = availableCommands();
  if (!query.trim()) return commands;
  const flattened = commands.flatMap(command => command.children
    ? command.children().map(option => ({ ...option, label: `${command.label}：${option.label}`, group: command.group, aliases: [...(command.aliases || []), ...(option.aliases || [])] }))
    : []);
  return filterCommands([...commands, ...flattened], query);
}

export const commandPalette = createPalette({
  id: 'command',
  rows: commandRows,
  renderRow: (row, command) => {
    row.classList.add('command-row');
    const title = document.createElement('span'); title.className = 'palette-row-title'; title.textContent = command.label;
    row.append(title);
    if (command.group) { const group = document.createElement('span'); group.className = 'palette-row-group'; group.textContent = command.group; row.append(group); }
    if (command.shortcut) { const shortcut = document.createElement('kbd'); shortcut.textContent = command.shortcut; row.append(shortcut); }
    if (command.current) { row.setAttribute('aria-current', 'true'); const check = document.createElement('span'); check.className = 'palette-row-check'; check.textContent = '✓'; row.append(check); }
    if (command.children) { const more = document.createElement('span'); more.className = 'palette-row-more'; more.textContent = '›'; row.append(more); }
  },
  empty: () => t('palette.noMatchingCommands'),
  levelChanged: parent => { $('command-hint').textContent = parent ? t(parent.children.typed ? 'palette.chooseOrTypeNumber' : 'palette.chooseOption') : t('palette.chooseCommand'); },
  choose: command => command.run(),
  closed: () => app.editor?.focus()
});

export function openCommands() { if (!app.state) return; closeBlockMenu(); closeLanguageMenu(); searchPalette.close(); nativeCommand('state'); commandPalette.show(); }

export function applyPaletteLanguage() {
  $('search-panel').setAttribute('aria-label', t('palette.searchNotes')); $('search-input').placeholder = t('palette.searchAllNotes'); $('search-input').setAttribute('aria-label', t('palette.searchAllNotes')); $('search-hint').textContent = t('palette.chooseNote');
  $('command-panel').setAttribute('aria-label', t('palette.commandPalette')); $('command-input').placeholder = t('palette.searchCommands'); $('command-input').setAttribute('aria-label', t('palette.searchCommands')); $('command-hint').textContent = t('palette.chooseCommand');
  if (commandPalette.open) commandPalette.render();
  if (searchPalette.open) searchPalette.render();
}
