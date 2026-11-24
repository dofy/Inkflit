import { StateEffect } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { app } from './app.js';
import { scopeAt } from './features.js';

const refreshNumbers = StateEffect.define();
let mode = 'off';

export function setCodeLineNumbers(enabled, relative) {
  const next = enabled ? (relative ? 'relative' : 'absolute') : 'off';
  if (next === mode) return;
  mode = next;
  app.editor?.dispatch({ effects: refreshNumbers.of(null) });
}

function lineNumbers(view) {
  if (mode === 'off') return Decoration.none;
  const { doc, selection } = view.state;
  const cursorLine = doc.lineAt(selection.main.head).number;
  const relativeScope = mode === 'relative' ? scopeAt(doc, cursorLine) : null;
  const decorations = [];
  let lastLine = 0;
  for (const range of view.visibleRanges) {
    for (let pos = range.from; pos <= range.to;) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= lastLine) continue;
      lastLine = line.number;
      const scope = scopeAt(doc, line.number);
      if (scope?.mode !== 'code') continue;
      const absolute = line.number - scope.start;
      const number = scope === relativeScope && line.number !== cursorLine
        ? Math.abs(line.number - cursorLine)
        : absolute;
      decorations.push(Decoration.line({ attributes: {
        class: 'cm-code-numbered-line',
        'data-code-line-number': String(number),
        style: `--code-number-width:${String(scope.last - scope.start).length}ch`,
      } }).range(line.from));
    }
  }
  return Decoration.set(decorations);
}

export const codeLineNumbers = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = lineNumbers(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged || (mode === 'relative' && update.selectionSet)
        || update.transactions.some(tr => tr.effects.some(effect => effect.is(refreshNumbers)))) {
      this.decorations = lineNumbers(update.view);
    }
  }
}, { decorations: plugin => plugin.decorations });
