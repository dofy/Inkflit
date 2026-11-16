import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, evaluateExpression, modeOf, parseTimer} from '../web/features.js';
import {timerCommand, timerDisplay, advanceTimer} from '../web/timer.js';
test('keywords are restricted to the first line and may have titles',()=>{ assert.equal(modeOf('list: Groceries\nmilk'),'list'); assert.equal(modeOf('my list\nsum'),''); });
test('math evaluates variables, percentages, units and currency without executing arbitrary code',()=>{
 const result=analyze('math\nprice: 80\nprice + 25% =\n50% of 200 =\n10 cm to in =\n// 100 =');
 assert.deepEqual(result.results.map(x=>x.text),['100','100','3.937007874 in']);
 assert.equal(evaluateExpression('10 USD to CNY',{}, {date:'2026-01-01',values:{USD:1,CNY:7}}).text,'70 CNY');
 for(const bad of ['import("x")','a=5','[1,2]','2^100000','constructor.constructor("return 1")()']) assert.equal(evaluateExpression(bad),null);
});
test('sum and average ignore comments and use equation results only once',()=>{
 assert.equal(analyze('sum\ncoffee 10\n2+3=\n// 100').summary,'合计 15 · 2 个数');
 assert.equal(analyze('avg\n3\n7\n// 500').summary,'平均 5 · 2 个数');
 assert.match(analyze('count\n你好 world\n\n// ignored').summary,/^1 项 · 2 词/);
});
test('timer parses durations, title, clock time and controls',()=>{
 assert.equal(parseTimer('timer 3:30').duration,210);
 assert.equal(parseTimer('timer 5: laundry: later').title,'laundry: later');
 assert.equal(parseTimer('timer pomo').rest,300);
 assert.equal(parseTimer('timer p').command,'p');
 const now=new Date(2026,0,1,20,0); assert.equal(parseTimer('timer 21:15',now).duration,4500);
 assert.equal(parseTimer('timer 5:99'),null);
});
test('timer pause, resume, reset and pomodoro maintain wall time',()=>{
 let t=timerCommand(null,parseTimer('timer 1 0.5'),1000);
 t=timerCommand(t,{command:'p'},11000); assert.equal(timerDisplay(t,30000).text,'00:50');
 t=timerCommand(t,{command:'p'},30000); assert.equal(timerDisplay(t,40000).text,'00:40');
 t=advanceTimer(t,80000); assert.equal(t.phase,'rest'); assert.equal(timerDisplay(t,80000).text,'00:30');
 t=timerCommand(t,{command:'r'},81000); assert.equal(t.phase,'work'); assert.equal(timerDisplay(t,81000).text,'01:00');
 assert.equal(timerCommand(t,{command:'s'},81000),null);
});

test('multiple independent feature blocks share one note without treating ordinary code as a list',async()=>{
 const {featureScopes,scopeAt,analyzeScopes}=await import('../web/features.js');
 const text='Notes\n```math\na: 10\na*2=\n```\n```list\napples\n```\n```sum\n4\n6\n```\n```js\n3+4=\n```';
 assert.deepEqual(featureScopes(text).map(x=>x.mode),['math','list','sum','code']);
 assert.equal(scopeAt(text,7).mode,'list'); assert.equal(scopeAt(text,14).mode,'code');
 const scopes=analyzeScopes(text); assert.equal(scopes[0].results[0].line,4); assert.equal(scopes[0].results[0].text,'20'); assert.equal(scopes[2].summary,'合计 10 · 2 个数');
});


test('code blocks coexist with features, including unlabeled and unfinished fences',async()=>{
 const {featureScopes,scopeAt,analyzeScopes}=await import('../web/features.js');
 const text='```code:javascript\nconst x = 3;\n```\n```math\n2+2=\n```\n```python title\nprint(1)\n```\n```\nraw';
 assert.deepEqual(featureScopes(text).map(s=>s.mode),['code','math','code','code']);
 assert.equal(scopeAt(text,2).mode,'code'); assert.equal(scopeAt(text,11).mode,'code');
 assert.equal(analyzeScopes(text)[1].results[0].text,'4');
});
test('code language names and aliases resolve to their syntax parser',async()=>{
 const {codeLanguage}=await import('../web/code-languages.js');
 assert.equal(codeLanguage('code:js')?.name,'JavaScript');
 assert.equal(codeLanguage('python')?.name,'Python');
 assert.equal(codeLanguage('code'),null);
});

test('independent blocks keep their scope and do not parse markup in code',async()=>{
 const {featureScopes,scopeAt,analyzeScopes}=await import('../web/features.js');
 const text='before\n:::quicknote math\nprice: 2\nprice*3=\n:::end\nbetween\n:::quicknote code javascript\n```math\n2+2=\n```\n:::end\nafter\n:::quicknote sum\n5\n:::end';
 assert.deepEqual(featureScopes(text).map(s=>s.mode),['math','code','sum']);
 assert.equal(scopeAt(text,4).mode,'math'); assert.equal(scopeAt(text,6),null); assert.equal(scopeAt(text,9).mode,'code'); assert.equal(scopeAt(text,12),null);
 assert.equal(analyzeScopes(text)[0].results[0].text,'6'); assert.equal(analyzeScopes(text)[2].summary,'合计 5 · 1 个数');
});

test('feature block markers reject ordinary edits but remain undoable',async()=>{
 const {EditorState,Transaction}=await import('@codemirror/state');
 const {blockProtection}=await import('../web/block-protection.js');
 const doc=':::quicknote sum\n2+3=\n:::end\n';
 const state=EditorState.create({doc,extensions:[blockProtection]});
 const blocked=state.update({changes:{from:15,to:16},annotations:Transaction.userEvent.of('delete')});
 assert.equal(blocked.state.doc.toString(),doc);
 const allowed=state.update({changes:{from:doc.indexOf('2'),to:doc.indexOf('2')+1,insert:'4'},annotations:Transaction.userEvent.of('input.type')});
 assert.match(allowed.state.doc.toString(),/4\+3/);
 const change=state.update({changes:{from:0,to:16,insert:':::quicknote math'},annotations:Transaction.userEvent.of('input.block')});
 assert.match(change.state.doc.toString(),/^:::quicknote math/);
});

test('Vim line deletion keeps the end marker and remains editable',async()=>{
 const {EditorState,Transaction}=await import('@codemirror/state');
 const {blockProtection}=await import('../web/block-protection.js');
 const doc=':::quicknote list\nfirst\nlast\n:::end\n';
 const state=EditorState.create({doc,extensions:[blockProtection]});
 const from=doc.indexOf('last'), to=doc.indexOf(':::end');
 const result=state.update({changes:{from,to},annotations:Transaction.userEvent.of('delete')});
 assert.equal(result.state.doc.toString(),':::quicknote list\nfirst\n\n:::end\n');
});

test('first cursor position and insertions preserve hidden block markers',async()=>{
 const {EditorState,Transaction}=await import('@codemirror/state');
 const {blockProtection,nearestEditablePosition}=await import('../web/block-protection.js');
 const doc=':::quicknote math\n3+4=\n:::end';
 const state=EditorState.create({doc,extensions:[blockProtection]});
 assert.equal(nearestEditablePosition(state.doc,0,0,true),doc.indexOf('3+4'));
 for(const from of [0,16]) {
   const result=state.update({changes:{from,insert:'x'},annotations:Transaction.userEvent.of('input.type')});
   assert.equal(result.state.doc.toString(),doc);
 }
});

test('copy excludes only structural markers and keeps code text',async()=>{
 const {EditorState}=await import('@codemirror/state'); const {visibleCopiedText}=await import('../web/block-protection.js');
 const text=':::quicknote list\n苹果\n梨\n:::end\n段落\n```text\n:::end\n```';
 const state=EditorState.create({doc:text,selection:{anchor:0,head:text.length}});
 assert.equal(visibleCopiedText(text,state),'苹果\n梨\n段落\n```text\n:::end\n```');
});
test('cross-block deletion preserves marker lines and allows undo',async()=>{
 const {EditorState,Transaction}=await import('@codemirror/state');const {history,undo}=await import('@codemirror/commands');const {blockProtection}=await import('../web/block-protection.js');
 const doc=':::quicknote list\n苹果\n:::end\n中间\n:::quicknote math\n2+3=\n:::end\n结尾';
 let state=EditorState.create({doc,extensions:[history(),blockProtection]});
 state=state.update({changes:{from:doc.indexOf('苹果'),to:doc.indexOf(':::end',doc.indexOf('2+3='))},annotations:Transaction.userEvent.of('delete')}).state;
 assert.equal(state.doc.toString(),':::quicknote list\n\n:::end\n\n:::quicknote math\n\n:::end\n结尾');
 let restored=state; assert.equal(undo({state,dispatch:tr=>restored=tr.state}),true); assert.equal(restored.doc.toString(),doc);
});


test('pasting over a cross-block selection replaces text without removing block boundaries',async()=>{
 const {EditorState,Transaction}=await import('@codemirror/state');const {history,undo}=await import('@codemirror/commands');const {blockProtection}=await import('../web/block-protection.js');
 const doc=':::quicknote list\n苹果\n:::end\n中间\n:::quicknote math\n2+3=\n:::end\n结尾';
 let state=EditorState.create({doc,extensions:[history(),blockProtection]});
 state=state.update({changes:{from:doc.indexOf('苹果'),to:doc.indexOf(':::end',doc.indexOf('2+3=')),insert:'新内容'},annotations:Transaction.userEvent.of('input.paste')}).state;
 assert.equal(state.doc.toString(),':::quicknote list\n新内容\n:::end\n\n:::quicknote math\n\n:::end\n结尾');
 let restored=state; assert.equal(undo({state,dispatch:tr=>restored=tr.state}),true); assert.equal(restored.doc.toString(),doc);
});

test('moving upward into a block lands on the last grapheme',async()=>{
 const {EditorState}=await import('@codemirror/state');const {nearestEditablePosition}=await import('../web/block-protection.js');
 const doc=':::quicknote list\n梨👩‍💻\n:::end\n段落';
 const state=EditorState.create({doc});const marker=doc.indexOf(':::end');
 assert.equal(nearestEditablePosition(state.doc,marker,doc.length,false),doc.indexOf('👩'));
});

test('delete block shortcut targets one complete block and can be undone',async()=>{
 const {EditorState}=await import('@codemirror/state');
 const {history,undo}=await import('@codemirror/commands');
 const {blockProtection}=await import('../web/block-protection.js');
 const {deleteCurrentBlock}=await import('../web/block-menu.js');
 const doc='before\n:::quicknote list\napple\n:::end\n:::quicknote math\n2+3=\n:::end\nafter';
 let state=EditorState.create({doc,selection:{anchor:doc.indexOf('apple')},extensions:[history(),blockProtection]});
 const view={get state(){return state},dispatch:spec=>{state=state.update(spec).state},focus(){}};
 assert.equal(deleteCurrentBlock(view),true);
 assert.equal(state.doc.toString(),'before\n:::quicknote math\n2+3=\n:::end\nafter');
 let restored=state;assert.equal(undo({state,dispatch:tr=>restored=tr.state}),true);assert.equal(restored.doc.toString(),doc);
 state=EditorState.create({doc,selection:{anchor:0},extensions:[history(),blockProtection]});
 assert.equal(deleteCurrentBlock(view),false);assert.equal(state.doc.toString(),doc);
 const broken=':::quicknote list\nunfinished';
 state=EditorState.create({doc:broken,selection:{anchor:broken.length},extensions:[history(),blockProtection]});
 assert.equal(deleteCurrentBlock(view),false);assert.equal(state.doc.toString(),broken);
});
