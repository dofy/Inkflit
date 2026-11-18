import { t } from './i18n.js';
import { syntaxTree } from '@codemirror/language';
import { scopeAt } from './features.js';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';

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
      const text = view.state.sliceDoc(this.position, this.position + 3);
      if (!/^\[[ xX]\]$/.test(text)) return;
      view.dispatch({changes:{from:this.position + 1, to:this.position + 2, insert:/[xX]/.test(text[1]) ? ' ' : 'x'}, userEvent:'input.task.toggle'});
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
// In normal mode a task marker is represented by a widget, so put the Vim
// cursor on its text rather than drawing a source character over the checkbox.
export function taskContentPosition(state, pos) {
  const line=state.doc.lineAt(pos);
  const match=/^(\s*(?:(?:[-+*]|\d+[.)])\s+)?)\[([ xX])\](?=\s|$)/.exec(line.text);
  if(!match)return pos;
  const from=line.from+match[1].length, end=from+3;
  if(pos<from || pos>=end)return pos;
  if(isTaskCode(state,line.number,from))return pos;
  return Math.min(line.to,end+(line.text[end-line.from]===' '?1:0));
}
function taskDecorations(view) {
  const decorations = [], state = view.state, doc = state.doc;
  for (const range of view.visibleRanges) {
    let line = doc.lineAt(range.from);
    while (line.from <= range.to) {
      const match = /^(\s*(?:(?:[-+*]|\d+[.)])\s+)?)\[([ xX])\](?=\s|$)/.exec(line.text);
      if (match) {
        const from = line.from + match[1].length, to = from + 3;
        if (!isTaskCode(state, line.number, from)) decorations.push(Decoration.replace({widget:new TaskCheckbox(from, /[xX]/.test(match[2]))}).range(from, to));
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
