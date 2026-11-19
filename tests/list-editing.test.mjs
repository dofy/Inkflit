import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { blockProtection } from '../web/block-protection.js';
import { planListIndent } from '../web/list-editing.js';
import { planTaskToggle } from '../web/tasks.js';

test('task toggle works at the beginning, middle and end of either kind of item', () => {
  for (const [doc, item, checked] of [
    [':::inkflit list\nroot task\n:::end', 'root task', '[x] root task'],
    ['list\nroot\n  [X] child task', '  [X] child task', '  [ ] child task'],
    ['- [ ] Markdown task', '- [ ] Markdown task', '- [x] Markdown task'],
    ['1. [x] Markdown task', '1. [x] Markdown task', '1. [ ] Markdown task'],
  ]) {
    for (const offset of [0, Math.floor(item.length / 2), item.length]) {
      const state = EditorState.create({ doc, selection: { anchor: doc.indexOf(item) + offset }, extensions: [markdown(), history(), blockProtection] });
      const plan = planTaskToggle(state);
      assert.ok(plan, item);
      let next = state.update(plan).state;
      assert.equal(next.doc.toString(), doc.replace(item, checked));
      assert.equal(undo({ state: next, dispatch: transaction => { next = transaction.state; } }), true);
      assert.equal(next.doc.toString(), doc);
    }
  }
});

test('a Markdown continuation toggles its closest task and ignores non-task children', () => {
  const doc = '- [ ] parent\n  parent detail\n  - [ ] child\n    child detail\n  - ordinary item\n    ordinary detail';
  for (const [text, item] of [['parent detail', 'parent'], ['child detail', 'child']]) {
    const state = EditorState.create({ doc, selection: { anchor: doc.indexOf(text) + 3 }, extensions: [markdown()] });
    const next = state.update(planTaskToggle(state)).state;
    assert.equal(next.doc.toString(), doc.replace(`[ ] ${item}`, `[x] ${item}`));
    assert.equal(next.selection.main.head, state.selection.main.head);
  }
  const state = EditorState.create({ doc, selection: { anchor: doc.indexOf('ordinary detail') }, extensions: [markdown()] });
  assert.equal(planTaskToggle(state), null);
});

test('task toggle ignores code, headings, comments and ordinary prose', () => {
  for (const doc of ['```text\n- [ ] fake\n```', '    [ ] fake', ':::inkflit code\n[ ] fake\n:::end', ':::inkflit list\n// fake\n:::end', ':::inkflit list\n## fake\n:::end', '- fake']) {
    const state = EditorState.create({ doc, selection: { anchor: doc.indexOf('fake') }, extensions: [markdown()] });
    assert.equal(planTaskToggle(state), null, doc);
  }
});

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
test('Tab moves tab-indented items and their descendants two visual columns',()=>{
 const state=make('list\nroot\n\tprevious\n\tpeer\n\t\tchild','peer');
 const result=apply(state,'Tab');
 assert.equal(result.doc.toString(),'list\nroot\n\tprevious\n\t  peer\n\t\t  child');
 assert.equal(result.selection.main.head,result.doc.line(4).from+3);
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
test('pasted items follow the same indent rules, keeping their own structure',async()=>{
 const {listPasteRules}=await import('../web/list-editing.js');
 const paste=(doc,at,text)=>{ const state=EditorState.create({doc,selection:{anchor:at},extensions:[history(),listPasteRules]});
  return state.update({changes:{from:at,insert:text},userEvent:'input.paste'}).state; };
 // The screenshot: an indented item pasted as the first item.
 let state=paste('list\n\n','list\n\n'.length,'  asdf\nasdf\n  asdf\n    asdfsadf');
 assert.equal(state.doc.toString(),'list\n\nasdf\nasdf\n  asdf\n    asdfsadf','the first item goes to the root');
 // A deeper pasted subtree is moved up as a whole under the previous item.
 state=paste(':::inkflit list\nroot\n\n:::end',':::inkflit list\nroot\n'.length,'      a\n        b');
 assert.equal(state.doc.toString(),':::inkflit list\nroot\n  a\n    b\n:::end');
 // Lines before the paste are not touched; typed text is not changed.
 const typed=EditorState.create({doc:'list\nroot\n',extensions:[listPasteRules]}).update({changes:{from:10,insert:'      x'},userEvent:'input.type'}).state;
 assert.equal(typed.doc.toString(),'list\nroot\n      x','only paste and drop are re-levelled');
 // One undo step removes the paste together with the fix.
 const withHistory=paste('list\n','list\n'.length,'    a');
 assert.equal(withHistory.doc.toString(),'list\na');
 let undone=withHistory; undo({state:undone,dispatch:tr=>{undone=tr.state;}});
 assert.equal(undone.doc.toString(),'list\n');
});
test('Vim put and shift follow the same indent rules',async()=>{
 const {listPasteRules}=await import('../web/list-editing.js');
 const run=(doc,spec)=>EditorState.create({doc,extensions:[listPasteRules]}).update({...spec,userEvent:'input.type.compose'}).state.doc.toString();
 assert.equal(run('list\nroot\n',{changes:{from:10,insert:'      a\n        b\n'}}),'list\nroot\n  a\n    b\n','p of indented lines');
 assert.equal(run('list\nroot\n  child',{changes:{from:10,insert:'    '}}),'list\nroot\n  child','>> past the limit is held back');
 const shift=EditorState.create({doc:'list\nroot\n  child',extensions:[listPasteRules]}).update({changes:{from:10,insert:'  '},userEvent:'indent.more'}).state.doc.toString();
 assert.equal(shift,'list\nroot\n  child','indent.more (Vim >>) past the limit is held back');
 const vimShift=EditorState.create({doc:'list\nroot\n  child',extensions:[listPasteRules]}).update({changes:{from:10,insert:'  '},userEvent:'input.indent'}).state.doc.toString();
 assert.equal(vimShift,'list\nroot\n  child','Vim >> (userEvent "input.indent") past the limit is held back');
 const typed=EditorState.create({doc:'list\nroot\n  child',extensions:[listPasteRules]}).update({changes:{from:10,insert:'  '},userEvent:'input.type'}).state.doc.toString();
 assert.equal(typed,'list\nroot\n    child','typed spaces are kept');
 assert.equal(run('list\nroot\n    deep',{changes:{from:14,to:15}}),'list\nroot\n    eep','x inside text is not re-levelled');
});
test('removing a line re-levels the lines below it',async()=>{
 const {listPasteRules}=await import('../web/list-editing.js');
 const run=(doc,spec,userEvent)=>EditorState.create({doc,extensions:[listPasteRules]}).update({...spec,userEvent}).state.doc.toString();
 const doc='list\nroot\n  parent\n    child\n      grandchild\nnext';
 // dd on "  parent" leaves "    child" two levels under root.
 const from=doc.indexOf('  parent'), to=doc.indexOf('    child');
 assert.equal(run(doc,{changes:{from,to}},'delete.line'),'list\nroot\n  child\n    grandchild\nnext');
 assert.equal(run(doc,{changes:{from,to}},'input.type.compose'),'list\nroot\n  child\n    grandchild\nnext','Vim dd');
 assert.equal(run(doc,{changes:{from,to}},'undo'),'list\nroot\n    child\n      grandchild\nnext','undo is left alone');
 assert.equal(run(doc,{changes:{from,to}}),'list\nroot\n    child\n      grandchild\nnext','changes without a user event are left alone');
});
test('whole-note list indentation respects nested block boundaries',async()=>{
 const {listPasteRules}=await import('../web/list-editing.js');
 const doc='list\nroot\n:::inkflit code python\n    keep()\n:::end\nchild';
 assert.equal(apply(make(doc,'child'),'Tab').doc.toString(),doc,'a nested block starts a new list tree');
 const at=doc.indexOf('root')+4;
 const state=EditorState.create({doc,extensions:[listPasteRules]});
 assert.equal(state.update({changes:{from:at,insert:'\n  item'},userEvent:'input.paste'}).state.doc.toString(),doc.replace('root','root\n  item'),'paste must preserve nested code indentation');
 const nested='list\n:::inkflit list\nroot\nchild\n:::end';
 const pos=nested.indexOf('child');
 assert.equal(EditorState.create({doc:nested,extensions:[listPasteRules]}).update({changes:{from:pos,insert:'      '},userEvent:'input.paste'}).state.doc.toString(),nested.replace('child','  child'),'nested checklists are normalized once');
 const fenced='list\nroot\n  parent\n    ```python\n    keep()\n    ```';
 assert.equal(apply(make(fenced,'parent'),'Shift-Tab').doc.toString(),fenced.replace('  parent','parent'),'moving a parent must leave a nested fence untouched');
});

test('tab prefixes survive indentation, outdent and history with mixed whitespace',()=>{
  for(const prefix of ['\t',' \t','\t ']) {
    const doc=`list\nroot\n${prefix}previous\n${prefix}peer\n${prefix}\tchild`;
    const state=make(doc,'peer'), next=apply(state,'Tab');
    assert.equal(next.doc.line(4).text,`${prefix}  peer`);
    assert.equal(next.doc.line(5).text,`${prefix}\t  child`);
    assert.equal(apply(next,'Shift-Tab').doc.toString(),doc);
    let undone=next;
    assert.equal(undo({state:next,dispatch:tr=>undone=tr.state}),true);
    assert.equal(undone.doc.toString(),doc);
  }
});
