import { EditorState, Transaction } from '@codemirror/state';
import { featureScopes } from './features.js';

export function markerRanges(doc) {
  const ranges=[];
  for(const scope of featureScopes(doc.toString())) {
    if(scope.kind!=='block')continue;
    const start=doc.line(scope.start);
    ranges.push({from:start.from,to:start.to,scope,kind:'start'});
    if(scope.closed) {const end=doc.line(scope.end);ranges.push({from:end.from,to:end.to,scope,kind:'end'});}
  }
  return ranges;
}
export function changesTouchMarkers(doc,changes) {
  const markers=markerRanges(doc);let touches=false;
  changes.iterChanges((from,to,_a,_b,inserted)=>{
    for(const m of markers) {
      const text=inserted.toString();
      if(from===to ? (from>m.from && from<m.to) || (from===m.from && !text.endsWith('\n')) || (from===m.to && !text.startsWith('\n')) : from < Math.min(doc.length,m.to+1) && to > Math.max(0,m.from-1)) {touches=true;break;}
    }
  });
  return touches;
}
export function nearestEditablePosition(doc, pos, previous=pos, changed=false) {
  for(const marker of markerRanges(doc)) {
    if(pos<marker.from || pos>marker.to)continue;
    const scope=marker.scope;
    if(marker.kind==='start') {
      if(!changed && previous>marker.to && marker.from>0)return marker.from-1;
      return scope.start<doc.lines ? doc.line(scope.start+1).from : marker.to;
    }
    if(!changed && previous<marker.from && marker.to<doc.length)return marker.to+1;
    if(scope.end>1) {
      const line=doc.line(scope.end-1);
      const segments=typeof Intl.Segmenter==='function' ? [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(line.text)] : Array.from(line.text).map(segment=>({segment}));
      return Math.max(line.from,line.to-(segments.at(-1)?.segment.length||0));
    }
    return marker.from;
  }
  return pos;
}
// Deleting the last content line must leave the newline separating the end marker.
export function trimFinalLineDeletion(doc, changes) {
  let edit=null,count=0;
  changes.iterChanges((from,to,_a,_b,inserted)=>{count++;edit={from,to,inserted};});
  if(count!==1 || !edit || edit.from===edit.to || edit.inserted.length!==0)return null;
  for(const scope of featureScopes(doc.toString())) {
    if(scope.kind!=='block' || !scope.closed || scope.start+1>=scope.end)continue;
    const first=doc.line(scope.start+1).from, end=doc.line(scope.end).from;
    if(edit.from>=first && edit.from<end-1 && edit.to===end) return {from:edit.from,to:end-1};
  }
  return null;
}
// Preserve both marker lines and their adjacent separators in cross-block deletes.
export function splitReplacementAroundMarkers(doc, changes) {
  let edit=null,count=0;
  changes.iterChanges((from,to,_a,_b,inserted)=>{count++;edit={from,to,inserted};});
  if(count!==1 || !edit || edit.from===edit.to)return null;
  const protectedRanges=markerRanges(doc).map(m=>({from:Math.max(0,m.from-1),to:Math.min(doc.length,m.to+1)})).sort((a,b)=>a.from-b.from);
  const result=[];let cursor=edit.from;
  for(const marker of protectedRanges) {
    if(marker.to<=cursor || marker.from>=edit.to)continue;
    if(marker.from>cursor)result.push({from:cursor,to:Math.min(marker.from,edit.to)});
    cursor=Math.max(cursor,marker.to);
    if(cursor>=edit.to)break;
  }
  if(cursor<edit.to)result.push({from:cursor,to:edit.to});
  if(!result.length)return null;
  if(edit.inserted.length) result[0].insert=edit.inserted;
  return result;
}
export function visibleCopiedText(text,state) {
  const ranges=state.selection.ranges.filter(range=>!range.empty);
  if(!ranges.length)return text;
  const original=ranges.map(range=>state.sliceDoc(range.from,range.to)).join(state.lineBreak);
  const suffix=text===original+'\n'?'\n':'';
  if(text!==original && !suffix)return text;
  const markers=markerRanges(state.doc);
  const output=ranges.map(range=>{
    let cursor=range.from, result='';
    for(const m of markers) {
      const from=Math.max(range.from,m.from),to=Math.min(range.to,m.to+1);
      if(from>=to)continue;
      result+=state.sliceDoc(cursor,from); cursor=to;
    }
    return result+state.sliceDoc(cursor,range.to);
  }).join(state.lineBreak);
  return output+suffix;
}
export const blockProtection=EditorState.transactionFilter.of(tr=>{
  const internal=tr.isUserEvent('input.block') || tr.isUserEvent('undo') || tr.isUserEvent('redo');
  if(tr.docChanged && !internal && changesTouchMarkers(tr.startState.doc,tr.changes)) {
    const trimmed=trimFinalLineDeletion(tr.startState.doc,tr.changes);
    if(trimmed) return {changes:trimmed,selection:{anchor:trimmed.from},userEvent:'delete'};
    const safeChanges=splitReplacementAroundMarkers(tr.startState.doc,tr.changes);
    if(safeChanges) {
      const insertLength=safeChanges[0].insert?.length||0;
      const event=tr.annotation(Transaction.userEvent)||'delete';
      return {changes:safeChanges,selection:{anchor:safeChanges[0].from+insertLength},userEvent:event};
    }
    const pos=nearestEditablePosition(tr.startState.doc,tr.startState.selection.main.head,tr.startState.selection.main.head,true);
    return {selection:{anchor:pos}};
  }
  const sel=tr.newSelection.main;
  if(!sel.empty)return tr;
  const safe=nearestEditablePosition(tr.newDoc,sel.head,tr.startState.selection.main.head,tr.docChanged);
  return safe===sel.head ? tr : [tr,{selection:{anchor:safe},sequential:true}];
});
