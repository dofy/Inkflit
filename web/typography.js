import { syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { isCodeAt } from './comments.js';

const headings=Array.from({length:6},(_,i)=>Decoration.line({class:`cm-note-heading cm-note-heading-${i+1}`}));

export function headingDecorations(state, ranges) {
  const result=[], seen=new Set(), doc=state.doc;
  for(const range of ranges) syntaxTree(state).iterate({from:range.from,to:range.to,enter(node) {
    const match=/^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
    if(!match)return;
    const line=doc.lineAt(node.from);
    if(seen.has(line.from) || isCodeAt(state,line.from))return;
    seen.add(line.from);result.push(headings[Number(match[1])-1].range(line.from));
  }});
  return Decoration.set(result,true);
}
export const noteHeadings=ViewPlugin.fromClass(class {
  constructor(view) { this.decorations=headingDecorations(view.state,view.visibleRanges); }
  update(update) {
    if(update.docChanged || update.viewportChanged || syntaxTree(update.startState)!==syntaxTree(update.state)) this.decorations=headingDecorations(update.state,update.view.visibleRanges);
  }
},{decorations:value=>value.decorations});

// Inline `code` gets a chip so it stands out from text that is already
// monospaced. Only InlineCode nodes: fenced code shares the same highlight
// tag, and Inkflit code blocks are skipped.
const inlineCode=Decoration.mark({class:'cm-note-inline-code'});
export function inlineCodeDecorations(state, ranges) {
  const result=[];
  for(const range of ranges) syntaxTree(state).iterate({from:range.from,to:range.to,enter(node) {
    if(node.name!=='InlineCode')return;
    if(!isCodeAt(state,node.from)) result.push(inlineCode.range(node.from,node.to));
    return false;
  }});
  return Decoration.set(result,true);
}
export const noteInlineCode=ViewPlugin.fromClass(class {
  constructor(view) { this.decorations=inlineCodeDecorations(view.state,view.visibleRanges); }
  update(update) {
    if(update.docChanged || update.viewportChanged || syntaxTree(update.startState)!==syntaxTree(update.state)) this.decorations=inlineCodeDecorations(update.state,update.view.visibleRanges);
  }
},{decorations:value=>value.decorations});
