import { scopeAt } from './features.js';
import { lineCommentMarker } from './code-languages.js';

export const indentationOptions = ['spaces2', 'spaces4', 'tabs'];
export function normalizeIndentation(value) { return indentationOptions.includes(value) ? value : 'spaces2'; }
const pairs = {'(':')','[':']','{':'}','"':'"',"'":"'",'`':'`'};
const openers = new Set(['(','[','{']);

// Track strings and comments inside the current code block so typing a quote
// in a comment or an existing string does not silently insert extra text.
function lexicalContext(text, language) {
  let quote='', blockComment=false, lineComment=false, escaped=false;
  // "//" languages also have /* */ comments; in Python "//" is floor division.
  const marker=lineCommentMarker(language), slashes=marker==='//';
  for(let i=0;i<text.length;i++) {
    const ch=text[i], next=text[i+1];
    if(lineComment) {if(ch==='\n')lineComment=false; continue;}
    if(blockComment) {if(ch==='*' && next==='/') {blockComment=false;i++;} continue;}
    if(quote) {
      if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(ch===quote)quote='';
      else if(ch==='\n' && quote!=='`')quote='';
      continue;
    }
    if(text.startsWith(marker,i)){lineComment=true;i+=marker.length-1;continue;}
    if(slashes && ch==='/' && next==='*'){blockComment=true;i++;continue;}
    if(ch==='"'||ch==="'"||ch==='`')quote=ch;
  }
  return {quote,comment:blockComment||lineComment,escaped};
}

// Return an editor transaction spec, or null to leave the key to Vim/CodeMirror.
export function planCodeEdit(state, key, options={}) {
  if(state.selection.ranges.length!==1)return null;
  const selection=state.selection.main, doc=state.doc;
  const start=scopeAt(doc,doc.lineAt(selection.from).number);
  const end=scopeAt(doc,doc.lineAt(selection.to).number);
  if(!start || start.mode!=='code' || !end || start.start!==end.start || start.end!==end.end)return null;
  const line=doc.lineAt(selection.head), pos=selection.head, empty=selection.empty;
  const scopeStart=doc.line(start.start+1).from;
  const fenceLanguage=start.kind==='fence' ? /^\s*(?:`{3,}|~{3,})\s*([\w+.-]+)/.exec(doc.line(start.start).text)?.[1]?.toLowerCase() : '';
  const language=start.language||fenceLanguage||'';
  const context=lexicalContext(doc.sliceString(scopeStart,selection.from),language);
  const next=doc.sliceString(selection.to,Math.min(doc.length,selection.to+1));
  const before=doc.sliceString(line.from,pos), after=doc.sliceString(pos,line.to);
  const unit=normalizeIndentation(options.indentation)==='tabs'?'\t':normalizeIndentation(options.indentation)==='spaces4'?'    ':'  ';
  const edit=(from,to,insert,anchor,userEvent='input.type')=>({changes:{from,to,insert},selection:{anchor},userEvent});

  if(key==='Enter') {
    if(!empty)return null;
    const base=/^[\t ]*/.exec(line.text)[0];
    const last=before.trimEnd().slice(-1), closer=pairs[last];
    const indentMore=!context.quote && !context.comment && (openers.has(last) || (language==='python' && last===':'));
    const whitespace=/^[\t ]*/.exec(after)[0];
    if(openers.has(last) && !context.quote && !context.comment && after.slice(whitespace.length).startsWith(closer)) {
      const insert='\n'+base+unit+'\n'+base;
      return edit(pos,pos+whitespace.length,insert,pos+1+base.length+unit.length);
    }
    const insert='\n'+base+(indentMore?unit:'');
    return edit(pos,pos,insert,pos+insert.length);
  }
  if(key==='Tab' && empty) return edit(pos,pos,unit,pos+unit.length);
  if(key==='Shift-Tab' && empty) {
    const leading=/^[\t ]*/.exec(line.text)[0];
    if(!leading)return null;
    const remove=leading.startsWith('\t')?1:Math.min(leading.length,unit==='\t'?4:unit.length);
    return edit(line.from,line.from+remove,'',Math.max(line.from,pos-remove),'delete.backward');
  }
  if(key==='Backspace' && empty && pos>line.from && !context.comment) {
    const prev=doc.sliceString(pos-1,pos);
    if(pairs[prev] && pairs[prev]===next)return edit(pos-1,pos+1,'',pos-1,'delete.backward');
    return null;
  }
  if(!pairs[key] && !Object.values(pairs).includes(key))return null;
  if(context.comment || context.escaped)return null;
  if(empty && next===key && !openers.has(key) && (!context.quote || context.quote===key))return {selection:{anchor:pos+1}};
  if(context.quote)return null;
  if(!pairs[key])return null;
  if((key==='"'||key==="'"||key==='`') && /[\w\p{L}]/u.test(doc.sliceString(Math.max(line.from,selection.from-1),selection.from)))return null;
  const selected=doc.sliceString(selection.from,selection.to), insert=key+selected+pairs[key];
  return edit(selection.from,selection.to,insert,selection.from+1+selected.length);
}
