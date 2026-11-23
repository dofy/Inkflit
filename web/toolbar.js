import { t, lang } from './i18n.js';
import { app, $, nativeHandler } from './app.js';

// Tell the native side where the toolbar buttons are, so the rest of the
// toolbar can drag the window.
function reportToolbarRegions() {
  const handler = nativeHandler();
  if (!handler) return;
  const rects = Array.from(document.querySelectorAll('header button'), button => {
    const r = button.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  handler.postMessage({ type: 'toolbarRegions', width: document.documentElement.clientWidth, rects });
}
export function watchToolbarRegions() {
  const observer = new ResizeObserver(reportToolbarRegions);
  for (const element of document.querySelectorAll('header, .nav, .actions, header button, #position')) observer.observe(element);
  window.addEventListener('resize', reportToolbarRegions);
  reportToolbarRegions();
}

let createdFormatter = null, createdFormatterLang = '';
// Local time in the app language; rebuilt only when the language changes.
function createdFormat() {
  if (createdFormatterLang !== lang()) { createdFormatterLang = lang(); createdFormatter = new Intl.DateTimeFormat(createdFormatterLang, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }
  return createdFormatter;
}

// Page counter, navigation buttons and the creation date in the footer.
export function refreshNav() {
  const { notes, selected } = app.state;
  const index = notes.findIndex(note => note.id === selected);
  $('position').textContent = `${index + 1} / ${notes.length}`;
  const created = new Date(notes[index]?.created ?? NaN);
  $('created').hidden = isNaN(created);
  $('created').textContent = isNaN(created) ? '' : createdFormat().format(created);
  $('previous').disabled = index === 0;
  $('next').disabled = index === notes.length - 1;
}

export function applyToolbarLanguage() {
  for (const [id, key, shortcut] of [['previous', 'note.previous', '⌘['], ['next', 'note.next', '⌘]'], ['new', 'note.new', '⌘N'], ['delete', 'note.delete', '⌘D'], ['search', 'palette.searchNotes', '⌘⇧F']]) {
    $(id).setAttribute('aria-label', t(key)); $(id).title = t(key) + ' ' + shortcut;
  }
  const pin = $('pin-window');
  pin.setAttribute('aria-label', t('toolbar.pinWindow'));
  pin.title = t('toolbar.pinWindow');
}
