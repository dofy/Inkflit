import { isolateHistory } from '@codemirror/commands';
import { scopeAt } from './features.js';

const unit=2;
const leading=text=>/^[ \t]*/.exec(text)[0];
const isHeading=text=>/^\s*#{1,6}(?:\s|$)/.test(text);
const isItem=text=>!!text.trim() && !/^\s*\/\//.test(text) && !isHeading(text);
function columns(indent,tabSize) {
  let result=0;
  for(const ch of indent) result=ch==='\t' ? result+tabSize-result%tabSize : result+1;
  return result;
}

// A checklist item may only become a child of a preceding item. Move its
// descendants with it so changing the parent never breaks the existing tree.
export function planListIndent(state, key) {
  if(key !== 'Tab' && key !== 'Shift-Tab') return null;
  const selection=state.selection.main;
  if(state.selection.ranges.length!==1 || !selection.empty) return null;
  const doc=state.doc, line=doc.lineAt(selection.head), scope=scopeAt(doc.toString(),line.number);
  if(scope?.mode!=='list' || !isItem(line.text)) return null;
  const tabSize=state.tabSize, indent=leading(line.text), depth=columns(indent,tabSize);
  if(key==='Tab') {
    let previous=null;
    for(let n=line.number-1;n>scope.start;n--) {
      const candidate=doc.line(n);
      if(isHeading(candidate.text)) break;
      if(isItem(candidate.text)) {previous=candidate; break;}
    }
    if(!previous || depth+unit>columns(leading(previous.text),tabSize)+unit) return {selection:state.selection};
  } else if(depth===0) return {selection:state.selection};
  const rows=[line];
  for(let n=line.number+1;n<scope.end && n<=doc.lines;n++) {
    const candidate=doc.line(n);
    if(isHeading(candidate.text)) break;
    if(!isItem(candidate.text)) continue;
    if(columns(leading(candidate.text),tabSize)<=depth) break;
    rows.push(candidate);
  }
  const changes=rows.map(row=>{
    const prefix=leading(row.text);
    const replacement=key==='Tab' ? '  '+prefix : ' '.repeat(Math.max(0,columns(prefix,tabSize)-unit));
    return {from:row.from,to:row.from+prefix.length,insert:replacement};
  });
  const replacement=changes[0].insert, offset=selection.head-line.from;
  const anchor=line.from+(offset>=indent.length ? offset+replacement.length-indent.length : Math.min(offset,replacement.length));
  return {changes,selection:{anchor},scrollIntoView:true,userEvent:'input.list.indent',annotations:isolateHistory.of('full')};
}
