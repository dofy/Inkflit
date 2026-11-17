import test from 'node:test';
import assert from 'node:assert/strict';
import { searchNotes, notePreview } from '../web/note-search.js';
test('search finds all notes in order and returns editable source offsets',()=>{
  const notes=[{id:'1',content:'First\nChinese 中文'},{id:'2',content:'hello\nCHINESE text'},{id:'3',content:'unrelated'}];
  const result=searchNotes(notes,'chinese');
  assert.deepEqual(result.map(x=>[x.id,x.index]),[['1',1],['2',2]]);
  for(const item of result) assert.equal(notes[item.index-1].content.slice(item.at,item.at+item.length).toLowerCase(),'chinese');
  assert.equal(searchNotes(notes,'中文')[0].id,'1');
  assert.deepEqual(searchNotes(notes,'  '),[]);
});
test('search treats query as literal, including regex punctuation',()=>{
  const notes=[{id:'1',content:'Price (USD) [20] + 3'}, {id:'2',content:'Price USD 20'}];
  assert.deepEqual(searchNotes(notes,'[20]').map(x=>x.id),['1']);
  assert.deepEqual(searchNotes(notes,'(USD)').map(x=>x.id),['1']);
});
test('search and previews exclude hidden feature markers but include their content',()=>{
  const note={id:'1',content:':::inkflit code javascript\nconst code = 2;\n:::end\nbody'};
  assert.equal(notePreview(note.content),'const code = 2;');
  assert.deepEqual(searchNotes([note],'inkflit'),[]);
  const match=searchNotes([note],'code')[0];
  assert.equal(note.content.slice(match.at,match.at+match.length),'code');
  assert.ok(match.at>note.content.indexOf('\n'));
  assert.equal(notePreview(':::inkflit list\n\n:::end'),'');
});
