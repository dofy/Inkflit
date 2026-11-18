import { isolateHistory } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';
import { scopeAt, scopesOf } from './features.js';

const unit=2;
const leading=text=>/^[ \t]*/.exec(text)[0];
const isHeading=text=>/^\s*#{1,6}(?:\s|$)/.test(text);
const isItem=text=>!!text.trim() && !/^\s*\/\//.test(text) && !isHeading(text);
function columns(indent,tabSize) {
  let result=0;
  for(const ch of indent) result=ch==='\t' ? result+tabSize-result%tabSize : result+1;
  return result;
}

// Keep the longest existing prefix that fits the new visual depth. Only a
// partially removed tab needs spaces to represent the remaining columns.
function resizeIndent(prefix,target,tabSize) {
  let kept='', depth=0;
  for(const ch of prefix) {
    const next=ch==='\t' ? depth+tabSize-depth%tabSize : depth+1;
    if(next>target) break;
    kept+=ch; depth=next;
  }
  return kept+' '.repeat(target-depth);
}

// A checklist item may only become a child of a preceding item. Move its
// descendants with it so changing the parent never breaks the existing tree.
export function planListIndent(state, key) {
  if(key !== 'Tab' && key !== 'Shift-Tab') return null;
  const selection=state.selection.main;
  if(state.selection.ranges.length!==1 || !selection.empty) return null;
  const doc=state.doc, line=doc.lineAt(selection.head), scope=scopeAt(doc,line.number);
  if(scope?.mode!=='list' || !isItem(line.text)) return null;
  const tabSize=state.tabSize, indent=leading(line.text), depth=columns(indent,tabSize);
  if(key==='Tab') {
    let previous=null;
    for(let n=line.number-1;n>scope.start;n--) {
      if(scopeAt(doc,n)!==scope) break;
      const candidate=doc.line(n);
      if(isHeading(candidate.text)) break;
      if(isItem(candidate.text)) {previous=candidate; break;}
    }
    if(!previous || depth+unit>columns(leading(previous.text),tabSize)+unit) return {selection:state.selection};
  } else if(depth===0) return {selection:state.selection};
  const last=scope.last, rows=[line];
  for(let n=line.number+1;n<=last && n<=doc.lines;n++) {
    if(scopeAt(doc,n)!==scope) break;
    const candidate=doc.line(n);
    if(isHeading(candidate.text)) break;
    if(!isItem(candidate.text)) continue;
    if(columns(leading(candidate.text),tabSize)<=depth) break;
    rows.push(candidate);
  }
  const changes=rows.map(row=>{
    const prefix=leading(row.text);
    const target=columns(prefix,tabSize)+(key==='Tab' ? unit : -unit);
    const replacement=resizeIndent(prefix,Math.max(0,target),tabSize);
    return {from:row.from,to:row.from+prefix.length,insert:replacement};
  });
  const replacement=changes[0].insert, offset=selection.head-line.from;
  const anchor=line.from+(offset>=indent.length ? offset+replacement.length-indent.length : Math.min(offset,replacement.length));
  return {changes,selection:{anchor},scrollIntoView:true,userEvent:'input.list.indent',annotations:isolateHistory.of('full')};
}

// Pasted items (and Vim p, P, >>, <<, and removed lines) keep the same rules as Tab: the first item is at the root and
// an item is at most one level deeper than its parent. Pasted lines and the
// ones after them are re-levelled, keeping their relative structure; lines
// before the paste are left as they are. Headings start a new tree.
export function listIndentFixes(state, from, to) {
  const doc=state.doc, tabSize=state.tabSize, firstLine=doc.lineAt(from).number, lastLine=doc.lineAt(to).number, changes=[];
  for(const scope of scopesOf(doc)) {
    if(scope.mode!=='list') continue;
    const last=Math.min(doc.lines, scope.last);
    if(lastLine<=scope.start || firstLine>last) continue;
    let stack=[];
    for(let n=scope.start+1;n<=last;n++) {
      if(scopeAt(doc,n)!==scope) { stack=[]; continue; }
      const line=doc.line(n);
      if(isHeading(line.text)) { stack=[]; continue; }
      if(!isItem(line.text)) continue;
      const prefix=leading(line.text), depth=columns(prefix,tabSize);
      while(stack.length && stack.at(-1).depth>=depth) stack.pop();
      const level=n<firstLine ? depth : (stack.length ? stack.at(-1).level+unit : 0);
      stack.push({depth,level});
      if(n>=firstLine && level!==depth) changes.push({from:line.from,to:line.from+prefix.length,insert:resizeIndent(prefix,level,tabSize)});
    }
  }
  return changes;
}
// Vim edits arrive as "input" (>> and <<) or "input.type.compose" (p, P):
// treat a put of whole lines and a change of leading whitespace only like a
// paste. Typing ("input.type") is left alone, so spaces you type stay.
function vimLayoutChange(tr) {
  const event=tr.annotation(Transaction.userEvent) || '';
  if(event!=='input' && !event.startsWith('input.type.compose')) return false;
  let put=false, indentOnly=true;
  tr.changes.iterChanges((fromA,toA,_fromB,_toB,inserted)=>{
    const text=inserted.toString(), removed=tr.startState.sliceDoc(fromA,toA);
    if(/\n/.test(text) && /\S/.test(text)) put=true;
    if(fromA!==tr.startState.doc.lineAt(fromA).from || !/^[ \t]*$/.test(text) || !/^[ \t]*$/.test(removed)) indentOnly=false;
  });
  return put || indentOnly;
}
// Removing a line break (dd, deleting selected lines, joining lines) can leave
// the lines below too deep, so it is re-levelled like a paste.
function removesLine(tr) {
  let removed=false;
  tr.changes.iterChanges((fromA,toA)=>{ if(/\n/.test(tr.startState.sliceDoc(fromA,toA))) removed=true; });
  return removed;
}
export const listPasteRules = EditorState.transactionFilter.of(tr => {
  const event=tr.annotation(Transaction.userEvent);
  // Only user edits: not loading, automation, undo / redo, or Tab's own indent.
  if(!tr.docChanged || !event || event==='undo' || event==='redo' || event==='input.list.indent') return tr;
  // "indent" covers indentMore / indentLess; Vim's >> and << arrive as "input.indent".
  if(!(tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop') || tr.isUserEvent('indent') || tr.isUserEvent('input.indent') || vimLayoutChange(tr) || removesLine(tr))) return tr;
  let from=Infinity, to=-1;
  tr.changes.iterChangedRanges((_a,_b,fromB,toB)=>{ from=Math.min(from,fromB); to=Math.max(to,toB); });
  const changes=listIndentFixes(tr.state, from, to);
  return changes.length ? [tr, {changes, sequential:true}] : tr;
});
