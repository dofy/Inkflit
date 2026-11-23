import { t } from './i18n.js';
import { app, $, nativeCommand, nativeHandler } from './app.js';
import { createPalette } from './palette.js';
import { filterCommands, rankCommands } from './command-palette.js';
import { searchNotes, notePreview } from './note-search.js';
import { closeBlockMenu } from './block-menu.js';
import { closeLanguageMenu } from './language-menu.js';
import { select } from './notes.js';
import { availableCommands, bindPaletteActions, runCommand, updateCommandState } from './commands.js';

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

export function setCommandState(value) { updateCommandState(value); if (commandPalette.open) commandPalette.render(); }

let commandHistory = [];
export function setCommandHistory(history) {
  commandHistory = Array.isArray(history) ? [...new Set(history)] : [];
}
function chooseCommand(command) {
  if (!runCommand(command)) return;
  commandHistory = [command.id, ...commandHistory.filter(id => id !== command.id)];
  nativeHandler()?.postMessage({ type: 'commandHistory', ids: commandHistory });
}

// First level: the commands, or while typing also every second-level option
// ("Language: English") so a value can be reached in one step.
function commandRows(query, parent) {
  if (parent) {
    const options = parent.children(), typed = parent.children.typed?.(query);
    const matches = filterCommands(options, query);
    const rows = typed && !matches.some(option => option.label === typed.label) ? [typed, ...matches] : matches;
    return rows.map(option => ({ ...option, id: parent.id, group: parent.group }));
  }
  const commands = rankCommands(availableCommands(), commandHistory);
  if (!query.trim()) return commands;
  const flattened = commands.flatMap(command => command.children
    ? command.children().map(option => ({ ...option, id: command.id, label: `${command.label}：${option.label}`, group: command.group, aliases: [...(command.aliases || []), ...(option.aliases || [])] }))
    : []);
  return filterCommands([...commands, ...flattened], query);
}

export const commandPalette = createPalette({
  id: 'command',
  rows: commandRows,
  renderRow: (row, command) => {
    row.classList.add('command-row');
    const title = document.createElement('span'); title.className = 'palette-row-title'; title.textContent = command.label;
    const group = document.createElement('span'); group.className = 'palette-row-group'; group.textContent = command.group || '';
    row.append(title, group);
    if (command.shortcut) {
      const shortcut = document.createElement('kbd'); shortcut.textContent = command.shortcut;
      row.append(shortcut);
    }
    const indicator = document.createElement('span'); indicator.className = 'palette-row-indicator'; indicator.setAttribute('aria-hidden', 'true');
    if (command.current) { row.setAttribute('aria-current', 'true'); indicator.classList.add('palette-row-check'); indicator.textContent = '✓'; }
    if (command.children) { indicator.classList.add('palette-row-more'); indicator.textContent = '›'; }
    row.append(indicator);
  },
  empty: () => t('palette.noMatchingCommands'),
  levelChanged: parent => { $('command-hint').textContent = parent ? t(parent.children.typed ? 'palette.chooseOrTypeNumber' : 'palette.chooseOption') : t('palette.chooseCommand'); },
  choose: chooseCommand,
  closed: () => app.editor?.focus()
});

export function openCommands() { if (!app.state) return; closeBlockMenu(); closeLanguageMenu(); searchPalette.close(); nativeCommand('state'); commandPalette.show(); }

bindPaletteActions({
  toggleSearch: () => { if (searchPalette.open) searchPalette.close(); else openSearch(); },
  toggleCommands: () => { if (commandPalette.open) commandPalette.close(); else openCommands(); }
});

export function applyPaletteLanguage() {
  $('search-panel').setAttribute('aria-label', t('palette.searchNotes')); $('search-input').placeholder = t('palette.searchAllNotes'); $('search-input').setAttribute('aria-label', t('palette.searchAllNotes')); $('search-hint').textContent = t('palette.chooseNote');
  $('command-panel').setAttribute('aria-label', t('palette.commandPalette')); $('command-input').placeholder = t('palette.searchCommands'); $('command-input').setAttribute('aria-label', t('palette.searchCommands')); $('command-hint').textContent = t('palette.chooseCommand');
  if (commandPalette.open) commandPalette.render();
  if (searchPalette.open) searchPalette.render();
}
