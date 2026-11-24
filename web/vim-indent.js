import { indentLess, indentMore, indentSelection, isolateHistory } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { EditorSelection, EditorState, StateEffect } from '@codemirror/state';
import { app } from './app.js';
import { markerRanges } from './block-protection.js';
import { codeIndentationUnit } from './code-editing.js';
import { codeLanguage } from './code-languages.js';
import { selectedLines } from './comments.js';
import { scopeAt } from './features.js';
import { listIndentFixes, planListSelectionShift } from './list-editing.js';

export function shiftVimListSelection(view, right) {
  const {state} = view;
  if (state.readOnly) return true;
  const plan = planListSelectionShift(state, selectedLines(state), right);
  if (!plan) return false;

  // For a motion spanning both checklists and other text, apply CodeMirror's
  // regular shift only to the other lines and commit the whole motion together.
  const markers = new Set(markerRanges(state.doc).map(marker => marker.from));
  const outside = new Set(plan.other.map(line => line.from).filter(from => !markers.has(from)));
  if (outside.size) {
    const otherState = state.update({
      selection: EditorSelection.create([...outside].map(from => EditorSelection.cursor(from))),
      effects: StateEffect.appendConfig.of(EditorState.allowMultipleSelections.of(true)),
      filter: false
    }).state;
    const command = right ? indentMore : indentLess;
    const changes = indentationChanges(otherState, 0, command);
    plan.changes.push(...changes.filter(change => outside.has(state.doc.lineAt(change.from).from)));
  }
  if (plan.changes.length) {
    view.dispatch({changes: plan.changes, userEvent: 'input.list.indent', annotations: isolateHistory.of('full')});
  }
  return true;
}

function indentationChanges(state, offset = 0, command = indentSelection) {
  const changes = [];
  command({state, dispatch: transaction => {
    transaction.changes.iterChanges((from, to, _start, _end, inserted) => {
      changes.push({from: offset + from, to: offset + to, insert: inserted.toString()});
    });
  }});
  return changes;
}

function codeChanges(state, scope, lines, language, unit) {
  const from = state.doc.line(scope.start + 1).from;
  const to = state.doc.line(scope.last).to;
  const code = EditorState.create({
    doc: state.sliceDoc(from, to),
    selection: EditorSelection.create(lines.map(line => EditorSelection.cursor(line.from - from))),
    extensions: [language, indentUnit.of(unit), EditorState.tabSize.of(state.tabSize), EditorState.allowMultipleSelections.of(true)]
  });
  return indentationChanges(code, from);
}

function scopeLanguage(doc, scope) {
  const fence = scope.kind === 'fence' ? /^\s*(?:`{3,}|~{3,})\s*(\S+)/.exec(doc.line(scope.start).text) : null;
  return codeLanguage(scope.language || fence?.[1] || '');
}

// Vim selects the operator's line range before invoking indentAuto. Use the
// note's scopes so Markdown indentation never rewrites a checklist or a code block.
export function indentVimSelection(view) {
  const {state} = view;
  if (state.readOnly) return true;
  const lists = new Set(), code = new Map(), other = new Set();
  for (const line of selectedLines(state)) {
    const scope = scopeAt(state.doc, line.number);
    if (scope?.mode === 'list') lists.add(line.number);
    else {
      const group = code.get(scope);
      const language = group?.language ?? (scope?.mode === 'code' ? scopeLanguage(state.doc, scope) : null);
      if (group) group.lines.push(line);
      else if (language) code.set(scope, {language, lines: [line]});
      else other.add(line.from);
    }
  }
  if (!lists.size && !code.size) return false;

  const markerStarts = new Set(markerRanges(state.doc).map(marker => marker.from));
  const changes = other.size
    ? indentationChanges(state).filter(change => other.has(change.from) && !markerStarts.has(change.from))
    : [];
  if (lists.size) {
    const lines = [...lists];
    changes.push(...listIndentFixes(state, state.doc.line(lines[0]).from, state.doc.line(lines.at(-1)).to, lists));
  }

  const unit = codeIndentationUnit(app.codeIndentation), pending = [];
  for (const [scope, {language, lines}] of code) {
    const calculate = support => changes.push(...codeChanges(state, scope, lines, support, unit));
    if (language.support) calculate(language.support);
    else pending.push(language.load().then(calculate, () => {}));
  }
  const apply = () => {
    if (!changes.length || app.editor !== view || view.state.doc !== state.doc ||
        view.state.readOnly || !app.vimEnabled || codeIndentationUnit(app.codeIndentation) !== unit) return;
    view.dispatch({changes, userEvent: 'input.auto-indent', annotations: isolateHistory.of('full')});
  };
  if (pending.length) Promise.all(pending).then(apply);
  else apply();
  return true;
}
