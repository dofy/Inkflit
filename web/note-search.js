import { featureScopes } from './features.js';

function hiddenMarkers(content) {
  const lines=content.split('\n'), starts=[];
  let offset=0;
  for(const line of lines) {starts.push(offset);offset+=line.length+1;}
  const ranges=[];
  for(const scope of featureScopes(content)) {
    if(scope.kind!=='block')continue;
    for(const number of [scope.start,...(scope.closed?[scope.end]:[])]) {
      const start=starts[number-1];ranges.push({from:start,to:start+lines[number-1].length});
    }
  }
  return ranges;
}
export function notePreview(content) {
  const markers=hiddenMarkers(content), lines=content.split('\n');let offset=0;
  for(const line of lines) {
    if(line.trim() && !markers.some(marker=>marker.from===offset))return line;
    offset+=line.length+1;
  }
  return '';
}
// Return one result per note, in the same order as the note navigation.
export function searchNotes(notes, query) {
  const needle=query.trim();
  if(!needle)return [];
  const pattern=new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
  const results=[];
  for(let index=0;index<notes.length;index++) {
    const note=notes[index], markers=hiddenMarkers(note.content);let match;
    pattern.lastIndex=0;
    while((match=pattern.exec(note.content))) {
      if(!markers.some(marker=>match.index < marker.to && match.index+match[0].length > marker.from))break;
    }
    const at=match?.index ?? -1;
    if(at<0)continue;
    const lineStart=note.content.lastIndexOf('\n',at-1)+1;
    const lineEnd=note.content.indexOf('\n',at), end=lineEnd<0?note.content.length:lineEnd;
    const from=Math.max(lineStart,at-48), to=Math.min(end,at+match[0].length+72);
    results.push({id:note.id,index:index+1,at,length:match[0].length,snippet:(from>lineStart?'…':'')+note.content.slice(from,to)+(to<end?'…':'')});
  }
  return results;
}
