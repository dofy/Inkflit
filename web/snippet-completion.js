import { autocompletion, CompletionContext, closeCompletion, snippet as fieldSnippet, hasNextSnippetField } from '@codemirror/autocomplete';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { t, lang } from './i18n.js';
import { nativeRequest } from './app.js';
import { isCodeAt } from './comments.js';
import { matchSnippets, snippetContext, addSnippetSource, templateSnippet, allSnippets, hasFields, fieldTemplate, plainText } from './snippets.js';
import { functionSnippets, unitSnippets, currencySnippets } from './math-snippets.js';
import { currencyCodes, loadRates } from './rates.js';
import { scopeAt } from './features.js';

const currentContext = () => snippetContext({ native: nativeRequest, locale: lang(), rates: loadRates });

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
// Math rows are added first, so user rows still lead any group they share.
addSnippetSource(() => [...functionSnippets, ...unitSnippets, ...currencySnippets(currencyCodes())]);
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

// A value with caret stops goes through CodeMirror's snippet fields: the
// caret lands on the first stop and Tab / ⇧Tab move between them (keys.js).
// Later lines then follow the indentation of the line it is inserted on.
// With `follow` false the caret stays where it is, and stops are dropped.
function insertValue(view, value, from, to, follow = true) {
  if (follow && hasFields(value)) { fieldSnippet(fieldTemplate(value))(view, null, from, to); return; }
  const insert = plainText(value);
  view.dispatch({ changes: { from, to, insert }, ...(follow ? { selection: { anchor: from + insert.length } } : {}), userEvent: 'input.complete' });
}

export function applySnippet(view, snippet, from, to) {
  let value;
  try { value = snippet.expand(currentContext()); } catch { reportFailure(snippet); return; }
  if (typeof value === 'string') { insertValue(view, value, from, to); return; }
  const id = {}, text = view.state.sliceDoc(from, to);
  view.dispatch({ effects: track.of({ id, from, to, text }) });
  const finish = result => {
    if (!view.dom.isConnected) return;  // the note was closed meanwhile
    const range = view.state.field(pending).get(id);
    const usable = range && typeof result === 'string' && view.state.sliceDoc(range.from, range.to) === range.text;
    view.dispatch({ effects: untrack.of(id) });
    if (!usable) return;
    // The value arrives later (an IP lookup). If the caret has moved on
    // meanwhile, it is not pulled back to the stops.
    const { main } = view.state.selection;
    insertValue(view, result, range.from, range.to, main.empty && main.head === range.to);
  };
  Promise.resolve(value).then(finish, () => { finish(null); reportFailure(snippet); });
}

export function snippetCompletions(context) {
  const word = context.matchBefore(/@[\w-]*/);
  if (!word) return null;
  // Math blocks, ```math fences included, offer the math rows. A number may
  // come right before "@" there, as in "10@km".
  const { state } = context, inMath = scopeAt(state.doc.toString(), state.doc.lineAt(word.from).number)?.mode === 'math';
  if ((inMath ? /[A-Za-z_@]/ : /[\w@]/).test(state.sliceDoc(word.from - 1, word.from))) return null;
  if (!inMath && inCode(state, word.from)) return null;
  // Formats that look the same in this language (English has no 年 or 日, so
  // "2026" and "18" repeat) are listed once.
  const now = currentContext(), shown = new Set();
  const rows = allSnippets().filter(row => inMath || !row.math);
  const matches = matchSnippets(word.text.slice(1), rows).filter(({ row }) => {
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
      if (text) { text = plainText(text); element.textContent = text.includes('\n') ? `${text.split('\n')[0]} …` : text; }
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
// CodeMirror marks every caret stop alike, so the one being filled is hard to
// tell apart. Its stop marks are among the editor's state decorations (not
// exported otherwise): find the stop holding the caret and mark it current.
class CurrentPoint extends WidgetType {
  toDOM() { const element = document.createElement('span'); element.className = 'cm-snippetCurrentPoint'; return element; }
  eq() { return true; }
}
const currentMark = Decoration.mark({ class: 'cm-snippetField-current' }), currentPoint = Decoration.widget({ widget: new CurrentPoint(), side: 1 });
const isStopWidget = deco => { try { return deco.spec.widget?.toDOM?.()?.className === 'cm-snippetFieldPosition'; } catch { return false; } };
export function currentStop(state) {
  if (!hasNextSnippetField(state)) return null;
  const { main } = state.selection, stops = [];
  for (const source of state.facet(EditorView.decorations)) {
    if (typeof source === 'function') continue;
    source.between(0, state.doc.length, (from, to, deco) => {
      if (deco.spec.class === 'cm-snippetField' || (from === to && isStopWidget(deco))) stops.push({ from, to });
    });
  }
  // A jump selects the whole stop, so an exact match wins; adjacent stops
  // ("{cursor:place}{cursor}") both touch the caret, so then the smallest.
  return stops.find(stop => stop.from === main.from && stop.to === main.to)
    ?? stops.filter(stop => stop.from <= main.from && main.to <= stop.to).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0] ?? null;
}
const currentStopMarker = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view.state); }
  // Stops start and end with a document, selection or effect change (Esc
  // ends them with an effect only); other updates leave the mark alone.
  update(update) {
    if (!update.docChanged && !update.selectionSet && !update.transactions.some(tr => tr.effects.length)) return;
    const next = this.build(update.state);
    if (next !== Decoration.none || this.decorations !== Decoration.none) this.decorations = next;
  }
  build(state) {
    const stop = currentStop(state);
    if (!stop) return Decoration.none;
    return Decoration.set(stop.from === stop.to ? [currentPoint.range(stop.from)] : [currentMark.range(stop.from, stop.to)]);
  }
}, { decorations: plugin => plugin.decorations });

export const snippets = [
  pending,
  // No typing or interaction delays: the source is cheap, and a quick Tab right
  // after typing a name should accept it rather than be ignored.
  autocompletion({ override: [snippetCompletions], icons: false, closeOnBlur: true, defaultKeymap: false, activateOnTypingDelay: 0, interactionDelay: 0,
    addToOptions: [{ render: renderHint, position: 70 }, { render: renderPreview, position: 80 }] }),
  currentStopMarker,
];
