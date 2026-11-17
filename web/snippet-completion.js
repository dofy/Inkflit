import { autocompletion, CompletionContext, closeCompletion } from '@codemirror/autocomplete';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { t, lang } from './i18n.js';
import { nativeRequest } from './app.js';
import { isCodeAt } from './comments.js';
import { matchSnippets, snippetContext, addSnippetSource, templateSnippet } from './snippets.js';

const currentContext = () => snippetContext({ native: nativeRequest, locale: lang() });

// Editor side of snippets: typing "@" offers matching snippets; Return or Tab
// replaces "@name" with the value. Not inside code, and not after a word
// character, so e-mail addresses and decorators are left alone.

function inCode(state, pos) {
  if (isCodeAt(state, pos)) return true;
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) if (node.name === 'InlineCode') return true;
  return false;
}

// User snippets from snippets.json, sent by the app (Settings → Snippets).
// Each is a template row; rows sharing a trigger form a group and lead the
// built-in group of the same name.
let userRows = [];
addSnippetSource(() => userRows);
export function setUserSnippets(list) {
  userRows = (Array.isArray(list) ? list : [])
    .filter(item => item && /^[a-z][a-z0-9-]*$/.test(item.trigger) && typeof item.content === 'string' && item.content)
    .map(({ trigger, content }) => {
      const row = templateSnippet(trigger, content);
      // Templates may hold clock or network placeholders, so the preview is
      // asked again after a second.
      return Object.assign(row, { preview: row.expand, previewTTL: 1000 });
    });
}

// "@name" being replaced by a value that is still loading. The range follows
// later edits; if the text changed meanwhile, the value is dropped.
export const track = StateEffect.define(), untrack = StateEffect.define();
export const pending = StateField.define({
  create: () => new Map(),
  update(ranges, tr) {
    let next = ranges;
    if (tr.docChanged) {
      next = new Map();
      for (const [id, range] of ranges) {
        const from = tr.changes.mapPos(range.from, 1), to = tr.changes.mapPos(range.to, -1);
        if (to - from === range.text.length) next.set(id, { ...range, from, to });
      }
    }
    for (const effect of tr.effects) {
      if (effect.is(track) || effect.is(untrack)) { if (next === ranges) next = new Map(ranges); }
      if (effect.is(track)) next.set(effect.value.id, effect.value);
      if (effect.is(untrack)) next.delete(effect.value);
    }
    return next;
  },
  // Dim the text while its value loads.
  provide: field => EditorView.decorations.from(field, ranges => Decoration.set([...ranges.values()].map(range => loading.range(range.from, range.to)), true))
});
const loading = Decoration.mark({ class: 'cm-snippet-loading' });

function reportFailure(snippet) {
  const footer = document.getElementById('save');
  if (!footer) return;
  footer.textContent = t('snippet.failed').replace('{name}', `@${snippet.trigger}`);
  footer.className = 'error'; footer.title = footer.textContent;
}

export function applySnippet(view, snippet, from, to) {
  let value;
  try { value = snippet.expand(currentContext()); } catch { reportFailure(snippet); return; }
  if (typeof value === 'string') {
    view.dispatch({ changes: { from, to, insert: value }, selection: { anchor: from + value.length }, userEvent: 'input.complete' });
    return;
  }
  const id = {}, text = view.state.sliceDoc(from, to);
  view.dispatch({ effects: track.of({ id, from, to, text }) });
  const finish = result => {
    if (!view.dom.isConnected) return;  // the note was closed meanwhile
    const range = view.state.field(pending).get(id);
    const usable = range && typeof result === 'string' && view.state.sliceDoc(range.from, range.to) === range.text;
    view.dispatch({ effects: untrack.of(id), ...(usable ? { changes: { from: range.from, to: range.to, insert: result }, userEvent: 'input.complete' } : {}) });
  };
  Promise.resolve(value).then(finish, () => { finish(null); reportFailure(snippet); });
}

export function snippetCompletions(context) {
  const word = context.matchBefore(/@[\w-]*/);
  if (!word) return null;
  if (/[\w@]/.test(context.state.sliceDoc(word.from - 1, word.from)) || inCode(context.state, word.from)) return null;
  // Formats that look the same in this language (English has no 年 or 日, so
  // "2026" and "18" repeat) are listed once.
  const now = currentContext(), shown = new Set();
  const matches = matchSnippets(word.text.slice(1)).filter(({ row }) => {
    if (!row.live) return true;
    let value; try { value = row.preview(now); } catch { return true; }
    const key = `${row.trigger}:${value}`;
    if (shown.has(key)) return false;
    shown.add(key); return true;
  });
  const options = matches.map(({ row, alias }) => ({
    label: `@${alias || row.trigger}`, snippet: row,
    apply: (view, completion, from, to) => applySnippet(view, row, from, to),
  }));
  // filter: false because matchSnippets already filtered, including aliases.
  return options.length ? { from: word.from, options, filter: false } : null;
}

// The right-hand column: the value a snippet will insert, or its description
// when there is no preview. Live previews (the clock) tick every second for
// as long as the row is on screen.
// A short label for rows of a group that would otherwise look alike.
function renderHint(completion) {
  if (!completion.snippet.hint) return null;
  const element = document.createElement('span');
  element.className = 'cm-snippet-hint'; element.textContent = t(completion.snippet.hint);
  return element;
}

// Async previews (IP, machine values) are shared while fresh, so every
// keystroke that re-renders the list does not ask again.
const previews = new Map();
function cachedPreview(snippet) {
  const cached = previews.get(snippet.id);
  if (cached && Date.now() - cached.time < snippet.previewTTL) return cached.value;
  // Failures are not kept, so the next render asks again.
  const forget = () => { if (previews.get(snippet.id)?.value === value) previews.delete(snippet.id); return null; };
  const value = Promise.resolve().then(() => snippet.preview(currentContext())).then(text => typeof text === 'string' ? text : forget(), forget);
  previews.set(snippet.id, { value, time: Date.now() });
  return value;
}
function renderPreview(completion) {
  const element = document.createElement('span');
  element.className = 'cm-completionDetail';
  const { snippet } = completion;
  const describe = () => { element.textContent = snippet.description ? t(snippet.description) : ''; };
  if (snippet.previewTTL) {
    describe();
    // One retry while the row is still shown, since the list may stay open.
    const show = retry => cachedPreview(snippet).then(text => {
      // Multi-line values show their first line.
      if (text) element.textContent = text.includes('\n') ? `${text.split('\n')[0]} …` : text;
      else if (retry) setTimeout(() => { if (element.isConnected) show(false); }, 1500);
    });
    show(true);
    return element;
  }
  const update = () => {
    let preview = null;
    try { preview = snippet.preview?.(currentContext()) ?? null; } catch {}
    if (typeof preview === 'string') element.textContent = preview; else describe();
  };
  update();
  // The row is in the list by the first tick; once it is gone, stop.
  if (snippet.live) { const timer = setInterval(() => { if (element.isConnected) update(); else clearInterval(timer); }, 1000); }
  return element;
}

// Accept the best match for the "@name" before the cursor right away. Used
// when Return or Tab arrives before the list has caught up with the last
// keystroke, so fast typing does not insert a newline instead.
export function acceptBestSnippet(view) {
  const result = snippetCompletions(new CompletionContext(view.state, view.state.selection.main.head, true));
  const best = result?.options[0];
  if (!best) return false;
  closeCompletion(view);
  best.apply(view, best, result.from, view.state.selection.main.head);
  return true;
}

// Keys for the open list (Return, Tab, arrows, Esc) are handled in keys.js.
export const snippets = [
  pending,
  // No typing or interaction delays: the source is cheap, and a quick Tab right
  // after typing a name should accept it rather than be ignored.
  autocompletion({ override: [snippetCompletions], icons: false, closeOnBlur: true, defaultKeymap: false, activateOnTypingDelay: 0, interactionDelay: 0,
    addToOptions: [{ render: renderHint, position: 70 }, { render: renderPreview, position: 80 }] }),
];
