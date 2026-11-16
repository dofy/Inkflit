import { syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { scopeAt } from './features.js';

export function isCodeAt(state, offset) {
  if (scopeAt(state.doc.toString(),state.doc.lineAt(offset).number)?.mode === 'code') return true;
  for (let node = syntaxTree(state).resolve(offset, 1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true;
  }
  return false;
}
export function selectedLines(state) {
  const numbers = new Set();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to > range.from ? range.to - 1 : range.to).number;
    for (let number = first; number <= last; number++) numbers.add(number);
  }
  return [...numbers].sort((a,b) => a-b).map(number => state.doc.line(number));
}
export function commentChanges(state, {includeCode = false} = {}) {
  const lines = selectedLines(state).filter(line => includeCode
    ? !/^[\t ]*(?:`{3,}|~{3,})/.test(line.text)
    : !isCodeAt(state, line.from));
  if (!lines.length) return [];
  const uncomment = lines.every(line => !line.text.trim() || /^[\t ]*\/\//.test(line.text));
  return lines.filter(line => line.text.trim()).flatMap(line => {
    const prefix = /^[\t ]*/.exec(line.text)[0].length;
    const marker = line.from + prefix;
    if (uncomment) {
      const length = line.text.slice(prefix).startsWith('// ') ? 3 : 2;
      return [{from:marker, to:marker+length, insert:''}];
    }
    return /^[\t ]*\/\//.test(line.text) ? [] : [{from:marker, insert:'// '}];
  });
}
export function blockCodeCommentChanges(state) {
  const lines=selectedLines(state), text=state.doc.toString();
  const scopes=lines.map(line=>scopeAt(text,line.number));
  if(!scopes.length || !scopes.every(scope=>scope?.kind==='block' && scope.mode==='code' && scope.start===scopes[0].start)) return null;
  const language=scopes[0].language.toLowerCase();
  const marker=['python','py','shell','sh','bash','ruby','rb'].includes(language)?'#':['sql'].includes(language)?'--':'//';
  const nonempty=lines.filter(line=>line.text.trim());
  const uncomment=nonempty.every(line=>line.text.trimStart().startsWith(marker));
  return nonempty.map(line=>{
    const indent=/^[\t ]*/.exec(line.text)[0].length, from=line.from+indent;
    if(!uncomment)return {from,insert:marker+' '};
    const after=line.text.slice(indent+marker.length);
    return {from,to:from+marker.length+(after.startsWith(' ')?1:0)};
  });
}
const commentLine = Decoration.line({class:'cm-note-comment'});
function decorations(view) {
  const result = [], doc = view.state.doc;
  for (const range of view.visibleRanges) {
    let line = doc.lineAt(range.from);
    while (line.from <= range.to) {
      if (/^[\t ]*\/\//.test(line.text) && !isCodeAt(view.state, line.from)) result.push(commentLine.range(line.from));
      if (line.to >= doc.length) break;
      line = doc.lineAt(line.to+1);
    }
  }
  return Decoration.set(result, true);
}
export const noteComments = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = decorations(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = decorations(update.view);
  }
}, {decorations:value => value.decorations});
