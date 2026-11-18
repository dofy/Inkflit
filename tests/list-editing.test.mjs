import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import { blockProtection } from '../web/block-protection.js';
import { planListIndent } from '../web/list-editing.js';

function make(doc, pos) { return EditorState.create({doc,selection:{anchor:doc.indexOf(pos)},extensions:[history(),blockProtection]}); }
function apply(state,key) { const spec=planListIndent(state,key); assert.ok(spec); return state.update(spec).state; }

test('Tab and Shift-Tab indent checklist items at the line start and keep the cursor',()=>{
 for(const item of ['apple','[x] apple','- [ ] apple']) {
  const doc=`:::inkflit list\nroot\n${item}\n:::end`, state=make(doc,'apple');
  const indented=apply(state,'Tab'); assert.equal(indented.doc.toString(),`:::inkflit list\nroot\n  ${item}\n:::end`);
  assert.equal(indented.selection.main.head,state.selection.main.head+2);
  const restored=apply(indented,'Shift-Tab'); assert.equal(restored.doc.toString(),doc);
  assert.equal(restored.selection.main.head,state.selection.main.head);
 }
});
test('root cannot indent and each item may be at most one level deeper than the previous item',()=>{
 const doc=':::inkflit list\nroot\nchild\n:::end';
 let state=make(doc,'root'); assert.equal(apply(state,'Tab').doc.toString(),doc);
 state=apply(make(doc,'child'),'Tab'); assert.equal(state.doc.toString(),':::inkflit list\nroot\n  child\n:::end');
 assert.equal(apply(state,'Tab').doc.toString(),state.doc.toString());
 const nested=':::inkflit list\nroot\n  parent\nchild\n:::end';
 state=apply(make(nested,'child'),'Tab'); state=apply(state,'Tab');
 assert.equal(state.doc.toString(),':::inkflit list\nroot\n  parent\n    child\n:::end');
 assert.equal(apply(state,'Tab').doc.toString(),state.doc.toString());
});
test('indent and outdent preserve the entire subtree, including undo and redo',()=>{
 const doc=':::inkflit list\nroot\nparent\n  child\n    grandchild\nnext\n:::end';
 let state=apply(make(doc,'parent'),'Tab');let next=state;
 const expected=':::inkflit list\nroot\n  parent\n    child\n      grandchild\nnext\n:::end';
 assert.equal(state.doc.toString(),expected);
 assert.equal(undo({state,dispatch:tr=>next=tr.state}),true);assert.equal(next.doc.toString(),doc);state=next;
 assert.equal(redo({state,dispatch:tr=>next=tr.state}),true);assert.equal(next.doc.toString(),expected);
 assert.equal(apply(next,'Shift-Tab').doc.toString(),doc);
});
test('outdent handles tabs, uneven whitespace, and headings are boundaries',()=>{
 for(const [indent,after] of [['\t','  '],[' ',''],['   ',' '],['','']]) {
  const doc=`:::inkflit list\nroot\n${indent}apple\n:::end`, result=apply(make(doc,'apple'),'Shift-Tab');
  assert.equal(result.doc.toString(),`:::inkflit list\nroot\n${after}apple\n:::end`);
 }
 const doc=':::inkflit list\nroot\n# section\nchild\n:::end';
 assert.equal(apply(make(doc,'child'),'Tab').doc.toString(),doc);
});
test('non-items, code and text outside a checklist are left alone',()=>{
 for(const [text,pos] of [[':::inkflit code\napple\n:::end','apple'],[':::inkflit list\n// comment\n:::end','comment'],[':::inkflit list\n# title\n:::end','title'],[':::inkflit list\n\n:::end','\n\n'],['ordinary','ordinary']]) assert.equal(planListIndent(make(text,pos),'Tab'),null);
});
test('a whole-note list follows the same rules, down to its last line',()=>{
 // The last line is the end of a whole-note list, not an ":::end" marker.
 let state=make('list\nroot\n  parent\n    child','parent');
 state=apply(state,'Shift-Tab');
 assert.equal(state.doc.toString(),'list\nroot\nparent\n  child','the last child moves with its parent');
 state=apply(make('list\nroot\nchild','child'),'Tab');
 assert.equal(state.doc.toString(),'list\nroot\n  child');
 assert.equal(apply(state,'Tab').doc.toString(),'list\nroot\n  child','at most one level deeper');
});
