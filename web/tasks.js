import { t } from './i18n.js';
import { isolateHistory } from '@codemirror/commands';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { scopeAt } from './features.js';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';

const markerPattern = /^(\s*(?:(?:[-+*]|\d+[.)])\s+)?)\[([ xX])\](?=\s|$)/;
export function taskMarker(line, offset = 0) {
  const match = markerPattern.exec(line.text.slice(offset));
  return match ? { from: line.from + offset + match[1].length, checked: match[2] !== ' ' } : null;
}
function toggleMarker(state, from) {
  const text = state.sliceDoc(from, from + 3);
  if (!/^\[[ xX]\]$/.test(text)) return null;
  return { from: from + 1, to: from + 2, insert: text[1] === ' ' ? 'x' : ' ' };
}
export function isChecklistItem(line) {
  const text = line.text.trim();
  return !!text && !/^(\/\/|#{1,6}(?:\s|$))/.test(text);
}
export function checklistToggleChange(state, line) {
  const marker = taskMarker(line);
  return marker ? toggleMarker(state, marker.from) : { from: line.from + /^\s*/.exec(line.text)[0].length, insert: '[x] ' };
}

class TaskCheckbox extends WidgetType {
  constructor(position, checked) { super(); this.position = position; this.checked = checked; }
  eq(other) { return this.position === other.position && this.checked === other.checked; }
  toDOM(view) {
    const button = document.createElement('button');
    button.className = 'task-checkbox'; button.type = 'button'; button.tabIndex = -1;
    button.setAttribute('aria-label', this.checked ? t('editor.markIncomplete') : t('editor.markComplete'));
    button.setAttribute('aria-checked', String(this.checked)); button.setAttribute('role', 'checkbox');
    button.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const changes = toggleMarker(view.state, this.position);
      if (!changes) return;
      view.dispatch({changes, userEvent:'input.task.toggle'});
      view.focus();
    });
    return button;
  }
  ignoreEvent() { return false; }
}
function isInCode(tree, offset) {
  for (let node = tree.resolveInner(offset, 1); node; node = node.parent) {
    if (['FencedCode','CodeBlock','InlineCode'].includes(node.name)) return true;
  }
  return false;
}
function isTaskCode(state, line, offset) {
  const mode = scopeAt(state.doc, line)?.mode;
  return mode === 'code' || (mode !== 'list' && isInCode(syntaxTree(state), offset));
}

function markdownTaskMarker(state, line) {
  const tree = ensureSyntaxTree(state, line.to, 30) ?? syntaxTree(state);
  const direct = taskMarker(line);
  if (direct) return isInCode(tree, direct.from) ? null : direct;
  // The end of the line resolves inside the item even when the cursor is on
  // its leading indentation. Stop at the closest nested item.
  for (let node = tree.resolveInner(line.to, -1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return null;
    if (node.name === 'ListItem') {
      const start = state.doc.lineAt(node.from);
      return taskMarker(start, node.from - start.from);
    }
  }
  return null;
}

export function planTaskToggle(state) {
  const { doc, selection } = state;
  const line = doc.lineAt(selection.main.head), scope = scopeAt(doc, line.number);
  if (scope && (scope.mode !== 'list' || !isChecklistItem(line))) return null;
  const marker = scope ? null : markdownTaskMarker(state, line);
  const changes = scope ? checklistToggleChange(state, line) : marker && toggleMarker(state, marker.from);
  return changes ? { changes, userEvent: 'input.task.toggle', annotations: isolateHistory.of('full') } : null;
}

// In normal mode a task marker is represented by a widget, so put the Vim
// cursor on its text rather than drawing a source character over the checkbox.
export function taskContentPosition(state, pos) {
  const line=state.doc.lineAt(pos);
  const marker=taskMarker(line);
  if(!marker)return pos;
  const { from } = marker, end=from+3;
  if(pos<from || pos>=end)return pos;
  if(isTaskCode(state,line.number,from))return pos;
  return Math.min(line.to,end+(line.text[end-line.from]===' '?1:0));
}
function taskDecorations(view) {
  const decorations = [], state = view.state, doc = state.doc;
  for (const range of view.visibleRanges) {
    let line = doc.lineAt(range.from);
    while (line.from <= range.to) {
      const marker = taskMarker(line);
      if (marker && !isTaskCode(state, line.number, marker.from)) {
        decorations.push(Decoration.replace({widget:new TaskCheckbox(marker.from, marker.checked)}).range(marker.from, marker.from + 3));
      }
      if (line.to >= doc.length) break;
      line = doc.lineAt(line.to + 1);
    }
  }
  return Decoration.set(decorations, true);
}
export const tasks = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = taskDecorations(view); }
  // Checkboxes depend on the visible text, not on the selection.
  update(update) { if (update.docChanged || update.viewportChanged || update.geometryChanged) this.decorations = taskDecorations(update.view); }
}, {decorations: value => value.decorations});
