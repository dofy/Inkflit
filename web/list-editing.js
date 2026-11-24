import { isolateHistory } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';
import { scopeAt, scopesOf } from './features.js';
import { checklistContentStart, isChecklistItem, taskMarker } from './tasks.js';

const unit=2;
const leading=text=>/^[ \t]*/.exec(text)[0];
const isHeading=text=>/^\s*#{1,6}(?:\s|$)/.test(text);
const nextColumn = (column, char, tabSize) => column + (char === '\t' ? tabSize - column % tabSize : 1);

// Character edits can touch the item text, while indentation and the hidden
// checkbox prefix are managed by Tab and the checkbox. Leave whole-line
// edits, paste, and explicit indentation to the list's layout rules.
export const checklistPrefixProtection = EditorState.changeFilter.of(tr => {
  const typing = tr.isUserEvent('input.type');
  if (!tr.docChanged || !(typing || tr.isUserEvent('delete'))) return true;
  const {doc} = tr.startState, prefixes = [];
  let blockedInsertion = false;
  tr.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
    const line = doc.lineAt(from);
    if (to > line.to || scopeAt(doc, line.number)?.mode !== 'list') return;
    const item = isChecklistItem(line);
    if (!item && line.text.trim()) return;
    const start = checklistContentStart(line);
    if (from === to) {
      if (item && from < start) blockedInsertion = true;
      if (!typing || from > start || !/^[ \t]+$/.test(inserted.toString())) return;
      // A manually typed checkbox at the end of the line needs one separator.
      const marker = taskMarker(line);
      if (!marker || from !== marker.from + 3 || from !== line.to || inserted.length !== 1) blockedInsertion = true;
    } else if (item && from < start && prefixes.at(-1) !== start) {
      prefixes.push(line.from, start);
    }
  });
  if (blockedInsertion) return false;
  return prefixes.length ? prefixes : true;
});
function columns(indent,tabSize) {
  let result=0;
  for(const ch of indent) result=nextColumn(result,ch,tabSize);
  return result;
}

// Keep the longest existing prefix that fits the new visual depth. Only a
// partially removed tab needs spaces to represent the remaining columns.
function resizeIndent(prefix,target,tabSize) {
  let kept='', depth=0;
  for(const ch of prefix) {
    const next=nextColumn(depth,ch,tabSize);
    if(next>target) break;
    kept+=ch; depth=next;
  }
  return kept+' '.repeat(target-depth);
}

function readIndent(line, tabSize) {
  const prefix = leading(line.text);
  return {line, prefix, depth: columns(prefix, tabSize)};
}

function* listItems(state, scope, from, to, step = 1) {
  const {doc, tabSize} = state;
  for (let n = from; step > 0 ? n <= to : n >= to; n += step) {
    const line = doc.line(n);
    if (scopeAt(doc, n) !== scope || isHeading(line.text)) yield null;
    else if (isChecklistItem(line)) yield readIndent(line, tabSize);
  }
}

function indentChange({line, prefix}, target, tabSize) {
  return {from: line.from, to: line.from + prefix.length, insert: resizeIndent(prefix, target, tabSize)};
}

// Inspect the tree before shifting any indentation. An item keeps its
// descendants even when Vim includes all of them in the selected lines.
function shiftSubtree(state, line, scope, shift, selectedThrough = line.number) {
  const {doc, tabSize} = state, item = readIndent(line, tabSize);
  const previous = shift > 0 ? listItems(state, scope, line.number - 1, scope.start + 1, -1).next().value : null;
  const canShift = shift > 0 ? previous && item.depth <= previous.depth : item.depth > 0;
  const end = Math.min(scope.last, doc.lines, canShift ? doc.lines : selectedThrough);
  const rows = [item];
  for (const child of listItems(state, scope, line.number + 1, end)) {
    if (!child || child.depth <= item.depth) break;
    rows.push(child);
  }
  const changes = canShift ? rows.map(row => indentChange(row, Math.max(0, row.depth + shift), tabSize)) : [];
  return {changes, lastLine: rows.at(-1).line.number};
}

export function planListIndent(state, key) {
  if (key !== 'Tab' && key !== 'Shift-Tab') return null;
  const selection = state.selection.main;
  if (state.selection.ranges.length !== 1 || !selection.empty) return null;
  const line = state.doc.lineAt(selection.head), scope = scopeAt(state.doc, line.number);
  if (scope?.mode !== 'list' || !isChecklistItem(line)) return null;
  const {changes} = shiftSubtree(state, line, scope, key === 'Tab' ? unit : -unit);
  if (!changes.length) return {selection: state.selection};
  const {from, to, insert} = changes[0], offset = selection.head - from, prefixLength = to - from;
  const anchor = from + (offset >= prefixLength ? offset + insert.length - prefixLength : Math.min(offset, insert.length));
  return {changes,selection:{anchor},scrollIntoView:true,userEvent:'input.list.indent',annotations:isolateHistory.of('full')};
}

export function planListSelectionShift(state, lines, right) {
  const changes = [], other = [];
  let shiftedThrough = 0;
  for (const line of lines) {
    const scope = scopeAt(state.doc, line.number);
    if (scope?.mode !== 'list') { other.push(line); continue; }
    if (line.number <= shiftedThrough || !isChecklistItem(line)) continue;
    const shift = shiftSubtree(state, line, scope, right ? unit : -unit, lines.at(-1).number);
    changes.push(...shift.changes);
    shiftedThrough = shift.lastLine;
  }
  return other.length === lines.length ? null : {changes, other};
}

// Pasted items (including Vim p and P) and removed lines follow the list's hierarchy. The first item is at the root and
// an item is at most one level deeper than its parent. Pasted lines and the
// ones after them are re-levelled, keeping their relative structure; lines
// before the paste are left as they are. Headings start a new tree.
export function listIndentFixes(state, from, to, selectedLines) {
  const doc=state.doc, tabSize=state.tabSize, firstLine=doc.lineAt(from).number, lastLine=doc.lineAt(to).number, changes=[];
  for(const scope of scopesOf(doc)) {
    if(scope.mode!=='list') continue;
    const last=Math.min(doc.lines, scope.last);
    if(lastLine<=scope.start || firstLine>last) continue;
    let stack=[], repair = !selectedLines;
    for (const item of listItems(state, scope, scope.start + 1, last)) {
      if (!item) { stack = []; repair = !selectedLines; continue; }
      const {line, depth} = item;
      const n = line.number;
      while(stack.length && stack.at(-1).depth>=depth) stack.pop();
      const parent = stack.at(-1);
      // An explicit Vim reindent starts at a selected item and stops at the next section.
      if (selectedLines?.has(n)) repair = true;
      const level = repair && n >= firstLine ? (parent ? parent.level + unit : 0) : depth;
      stack.push({depth, level});
      if (level !== depth) changes.push(indentChange(item, level, tabSize));
    }
  }
  return changes;
}
// Unlabeled Vim edits can also put whole lines or change leading whitespace.
// Regular typing does not re-level the surrounding list.
function indentRepairRange(tr, event) {
  const explicit = ['input.paste', 'input.drop', 'indent', 'input.indent'].some(type => tr.isUserEvent(type));
  const vim = event === 'input' || event.startsWith('input.type.compose');
  const {doc} = tr.startState;
  let from = Infinity, to = -1, removesLine = false, put = false, indentOnly = vim;
  tr.changes.iterChanges((start, end, newStart, newEnd, inserted) => {
    from = Math.min(from, newStart);
    to = Math.max(to, newEnd);
    if (explicit) return;
    // Deleting or joining a line can leave descendants too deep.
    const removed = doc.sliceString(start, end);
    if (removed.includes('\n')) removesLine = true;
    if (!vim) return;
    const text = inserted.toString();
    if (text.includes('\n') && /\S/.test(text)) put = true;
    if (start !== doc.lineAt(start).from || !/^[ \t]*$/.test(text) || !/^[ \t]*$/.test(removed)) indentOnly = false;
  });
  return explicit || removesLine || put || indentOnly ? {from, to} : null;
}
// Deleting the first character of "- item" exposes a separator space. Remove
// only the newly exposed whitespace, keeping the item's existing prefix.
function exposedChecklistSpaces(tr) {
  if (!(tr.isUserEvent('input.type') || tr.isUserEvent('delete'))) return [];
  const before = tr.startState.doc, after = tr.newDoc, changes = [];
  tr.changes.iterChangedRanges((from, to, at, end) => {
    if (from === to || at !== end) return;
    const line = before.lineAt(from);
    if (to > line.to || scopeAt(before, line.number)?.mode !== 'list' || !isChecklistItem(line)) return;
    if (from !== checklistContentStart(line)) return;
    const spaces = leading(after.sliceString(at, after.lineAt(at).to)).length;
    if (spaces) changes.push({from:at, to:at + spaces});
  });
  return changes;
}
export const listPasteRules = EditorState.transactionFilter.of(tr => {
  const event=tr.annotation(Transaction.userEvent);
  // Formatting affects code/math only, even if edits span a checklist.
  if(!tr.docChanged || !event || event==='undo' || event==='redo' || event==='input.list.indent' || event==='input.format') return tr;
  const range = indentRepairRange(tr, event);
  const changes = range ? listIndentFixes(tr.state, range.from, range.to) : exposedChecklistSpaces(tr);
  return changes.length ? [tr, {changes, sequential:true}] : tr;
});
