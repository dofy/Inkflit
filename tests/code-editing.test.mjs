import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { planCodeEdit, normalizeIndentation } from '../web/code-editing.js';

function inBlock(text, offset=text.length, language='javascript') {
  const prefix=`:::inkflit code ${language}\n`;
  return EditorState.create({doc:prefix+text+'\n:::end',selection:{anchor:prefix.length+offset}});
}
function apply(state,key,indentation='spaces2') {
  const spec=planCodeEdit(state,key,{indentation});
  return spec ? state.update(spec).state : null;
}
function body(state) {return state.doc.toString().split('\n').slice(1,-1).join('\n');}

test('code pairs, closing skips and paired backspace preserve the cursor',()=>{
  let state=apply(inBlock(''),'{');
  assert.equal(body(state),'{}');
  state=apply(state,'"'); assert.equal(body(state),'{""}');
  state=apply(state,'"'); assert.equal(body(state),'{""}');
  state=apply(state,'}'); assert.equal(body(state),'{""}');
  state=apply(inBlock(''), '['); state=apply(state,'Backspace'); assert.equal(body(state),'');
  state=apply(inBlock('(' ,0),'('); assert.equal(body(state),'()(');
});
test('quotes and brackets are not auto-inserted in strings and comments',()=>{
  assert.equal(planCodeEdit(inBlock('// comment'),'"'),null);
  assert.equal(planCodeEdit(inBlock('"hello'),'('),null);
  assert.equal(planCodeEdit(inBlock("don't"),"'"),null);
  assert.equal(planCodeEdit(inBlock('# comment',undefined,'python'),'('),null);
});
test('enter indents between pairs and supports spaces, tabs and Python colon',()=>{
  for(const [value,unit] of [['spaces2','  '],['spaces4','    '],['tabs','\t']]) {
    const state=apply(inBlock('  {}',3),'Enter',value);
    assert.equal(body(state),'  {\n  '+unit+'\n  }');
    assert.equal(state.selection.main.head,state.doc.line(3).to);
  }
  assert.equal(body(apply(inBlock('if ready:',undefined,'python'),'Enter')),'if ready:\n  ');
  assert.equal(body(apply(inBlock('  value'),'Enter')),'  value\n  ');
  assert.equal(body(apply(inBlock('// {'),'Enter')),'// {\n');
});
test('tab and outdent use the chosen indentation without affecting ordinary text',()=>{
  assert.equal(body(apply(inBlock('x'),'Tab','spaces4')),'x    ');
  assert.equal(body(apply(inBlock('    x'),'Shift-Tab','spaces4')),'x');
  assert.equal(body(apply(inBlock('\tx'),'Shift-Tab','tabs')),'x');
  const plain=EditorState.create({doc:'ordinary',selection:{anchor:8}});
  assert.equal(planCodeEdit(plain,'('),null);
  assert.equal(normalizeIndentation('invalid'),'spaces2');
});
test('markdown code fences also receive code editing without changing boundaries',()=>{
  const doc='```python\nif ok:\n```', pos=doc.indexOf('if ok:')+6;
  const state=EditorState.create({doc,selection:{anchor:pos}});
  assert.equal(apply(state,'Enter').doc.toString(),'```python\nif ok:\n  \n```');
});
test('a whole-note code mode edits like a code block, down to its last line',async()=>{
 const doc='code js\nif (a) {', state=EditorState.create({doc,selection:{anchor:doc.length}});
 assert.equal(apply(state,'Enter').doc.toString(),'code js\nif (a) {\n  ','Return indents after a bracket on the last line');
 assert.equal(planCodeEdit(EditorState.create({doc,selection:{anchor:3}}),'Enter'),null,'the header line is not code');
 const {blockCodeCommentChanges}=await import('../web/comments.js');
 const py='code py\nprint(1)', pyState=EditorState.create({doc:py,selection:{anchor:py.length}});
 assert.deepEqual(blockCodeCommentChanges(pyState),[{from:py.indexOf('print'),insert:'# '}],'comments use the language syntax');
});
