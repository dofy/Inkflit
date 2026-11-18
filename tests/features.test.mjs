import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, analyzeScopes, evaluateExpression, modeOf, mathHighlights} from '../web/features.js';
test('math treats bare min as minutes and knows mph and nmi',()=>{
 assert.equal(evaluateExpression('90 min to h').text,'1.5 h');
 assert.equal(evaluateExpression('2 h to min').text,'120 min');
 assert.equal(evaluateExpression('min(3, 7)').text,'3');
 assert.equal(evaluateExpression('min * 2',{min:5}).text,'10');
 assert.equal(evaluateExpression('60 mph to km/h').text,'96.56064 km / h');
 assert.equal(evaluateExpression('1 nmi to m').text,'1852 m');
});
test('keywords are restricted to the first line and may have titles',()=>{ assert.equal(modeOf('list: Groceries\nmilk'),'list'); assert.equal(modeOf('my list\nsum'),''); });
test('math evaluates variables, percentages, units and currency without executing arbitrary code',()=>{
 const result=analyze('math\nprice: 80\nprice + 25% =\n50% of 200 =\n10 cm to in =\n// 100 =');
 assert.deepEqual(result.results.map(x=>x.text),['100','100','3.937007874 in']);
 assert.equal(evaluateExpression('10 USD to CNY',{}, {date:'2026-01-01',values:{USD:1,CNY:7}}).text,'70 CNY');
 for(const bad of ['import("x")','a=5','[1,2]','2^100000','constructor.constructor("return 1")()']) assert.equal(evaluateExpression(bad),null);
});
test('sum and average extract numbers without evaluating expressions or conversions',()=>{
 for(const mode of ['sum','avg']) {
  const result=analyze(`${mode}\nprice: 80\nprice * 2 =\n10 km to mi =\n// 100`);
  assert.equal(result.results.length,0);
  assert.equal(result.summary,mode==='sum'?'合计 92 · 3 个数':'平均 30.66666667 · 3 个数');
 }
 const expression=analyze('sum\ncoffee 10\n2+3=\n// 100');
 assert.equal(expression.summary,'合计 15 · 3 个数');
 assert.equal(expression.results.length,0);
 assert.equal(analyze('avg\n3\n7\n// 500').summary,'平均 5 · 2 个数');
 assert.match(analyze('count\n你好 world\n\n// ignored').summary,/^1 项 · 2 词/);
});
test('multiple independent feature blocks share one note without treating ordinary code as a list',async()=>{
 const {featureScopes,scopeAt,analyzeScopes}=await import('../web/features.js');
 const text='Notes\n```math\na: 10\na*2=\n```\n```list\napples\n```\n```sum\n4\n6\n```\n```js\n3+4=\n```';
 assert.deepEqual(featureScopes(text).map(x=>x.mode),['math','list','sum','code']);
 assert.equal(scopeAt(text,7).mode,'list'); assert.equal(scopeAt(text,14).mode,'code');
 const scopes=analyzeScopes(text); assert.equal(scopes[0].results[0].line,4); assert.equal(scopes[0].results[0].text,'20'); assert.equal(scopes[2].summary,'合计 10 · 2 个数');
});

test('plain text conversion is offered only when changing an existing block',async()=>{
 const {blockMenuChoices}=await import('../web/block-menu.js');
 const newChoices=blockMenuChoices(null).map(([id])=>id);
 const existingChoices=blockMenuChoices({kind:'block'}).map(([id])=>id);
 assert.ok(!newChoices.includes('text') && !newChoices.includes('delete'));
 assert.ok(existingChoices.includes('text') && existingChoices.includes('delete'));
});


test('math variable highlights cover only definitions and references in this block',async()=>{
 const {mathVariableRanges}=await import('../web/features.js');
 const lines=['price * 2 =','price: 80','price * price =','tax: price * 0.1','price and tax are notes','// price =','10 km to mi =','```','price =','```','total: tax + price','total =','other_price ='];
 const names=mathVariableRanges(lines).map(r=>[r.line,lines[r.line].slice(r.from,r.to)]);
 assert.deepEqual(names,[[1,'price'],[2,'price'],[2,'price'],[3,'tax'],[3,'price'],[10,'total'],[10,'tax'],[10,'price'],[11,'total']]);
 assert.deepEqual(mathVariableRanges(['price =']),[]);
});

test('feature type conversion recalculates from unchanged body',async()=>{
 const {analyzeScopes}=await import('../web/features.js');
 const body='price: 80\nprice * 2 =\n10 km to mi =';
 const doc=mode=>`:::inkflit ${mode}\n${body}\n:::end`;
 const math=analyzeScopes(doc('math'))[0];
 assert.equal(math.results.length,2); assert.equal(math.results[0].text,'160');
 assert.match(math.results[1].text,/^6\.213711922 mi$/);
 for(const mode of ['sum','avg']) {
   const result=analyzeScopes(doc(mode))[0];
   assert.equal(result.results.length,0);
   assert.equal(result.summary,mode==='sum'?'合计 92 · 3 个数':'平均 30.66666667 · 3 个数');
 }
 assert.equal(doc('math').split('\n').slice(1,-1).join('\n'),body);
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
 const text='before\n:::inkflit math\nprice: 2\nprice*3=\n:::end\nbetween\n:::inkflit code javascript\n```math\n2+2=\n```\n:::end\nafter\n:::inkflit sum\n5\n:::end';
 assert.deepEqual(featureScopes(text).map(s=>s.mode),['math','code','sum']);
 assert.equal(scopeAt(text,4).mode,'math'); assert.equal(scopeAt(text,6),null); assert.equal(scopeAt(text,9).mode,'code'); assert.equal(scopeAt(text,12),null);
 assert.equal(analyzeScopes(text)[0].results[0].text,'6'); assert.equal(analyzeScopes(text)[2].summary,'合计 5 · 1 个数');
});

test('feature block markers reject ordinary edits but remain undoable',async()=>{
 const {EditorState,Transaction}=await import('@codemirror/state');
 const {blockProtection}=await import('../web/block-protection.js');
 const doc=':::inkflit sum\n2+3=\n:::end\n';
 const state=EditorState.create({doc,extensions:[blockProtection]});
 const blocked=state.update({changes:{from:13,to:14},annotations:Transaction.userEvent.of('delete')});
 assert.equal(blocked.state.doc.toString(),doc);
 const allowed=state.update({changes:{from:doc.indexOf('2'),to:doc.indexOf('2')+1,insert:'4'},annotations:Transaction.userEvent.of('input.type')});
 assert.match(allowed.state.doc.toString(),/4\+3/);
 const change=state.update({changes:{from:0,to:16,insert:':::inkflit math'},annotations:Transaction.userEvent.of('input.block')});
 assert.match(change.state.doc.toString(),/^:::inkflit math/);
});

test('Vim line deletion keeps the end marker and remains editable',async()=>{
 const {EditorState,Transaction}=await import('@codemirror/state');
 const {blockProtection}=await import('../web/block-protection.js');
 const doc=':::inkflit list\nfirst\nlast\n:::end\n';
 const state=EditorState.create({doc,extensions:[blockProtection]});
 const from=doc.indexOf('last'), to=doc.indexOf(':::end');
 const result=state.update({changes:{from,to},annotations:Transaction.userEvent.of('delete')});
 assert.equal(result.state.doc.toString(),':::inkflit list\nfirst\n\n:::end\n');
});

test('Vim can delete a trailing blank line without removing block markers',async()=>{
 const {EditorState,Transaction}=await import('@codemirror/state');
 const {history,undo,redo}=await import('@codemirror/commands');
 const {blockProtection}=await import('../web/block-protection.js');
 for(const type of ['list','code json']) {
  const original=`:::inkflit ${type}\nfirst\n\n:::end`;
  let state=EditorState.create({doc:original,extensions:[history(),blockProtection]});
  const end=original.indexOf(':::end');
  state=state.update({changes:{from:end-1,to:end},annotations:Transaction.userEvent.of('delete')}).state;
  assert.equal(state.doc.toString(),`:::inkflit ${type}\nfirst\n:::end`);
  let next=state; assert.equal(undo({state,dispatch:tr=>next=tr.state}),true); state=next;
  assert.equal(state.doc.toString(),original);
  assert.equal(redo({state,dispatch:tr=>next=tr.state}),true);
  assert.equal(next.doc.toString(),`:::inkflit ${type}\nfirst\n:::end`);
  const sole=`:::inkflit ${type}\n\n:::end`, marker=sole.indexOf(':::end');
  const empty=EditorState.create({doc:sole,extensions:[blockProtection]});
  assert.equal(empty.update({changes:{from:marker-1,to:marker},annotations:Transaction.userEvent.of('delete')}).state.doc.toString(),sole);
 }
});

test('whole lines before a feature block can be removed and undone without joining its marker',async()=>{
 const {EditorState,Transaction}=await import('@codemirror/state');
 const {history,undo}=await import('@codemirror/commands');
 const {blockProtection}=await import('../web/block-protection.js');
 const original='// comment\n\n:::inkflit code json\n{}\n:::end';
 let state=EditorState.create({doc:original,extensions:[history(),blockProtection]});
 const marker=state.doc.toString().indexOf(':::inkflit');
 state=state.update({changes:{from:0,to:marker},annotations:Transaction.userEvent.of('delete')}).state;
 assert.equal(state.doc.toString(),':::inkflit code json\n{}\n:::end');
 let restored=state; assert.equal(undo({state,dispatch:tr=>restored=tr.state}),true); assert.equal(restored.doc.toString(),original);
 const doc='before\n\n:::inkflit list\nitem\n:::end';
 state=EditorState.create({doc,extensions:[blockProtection]});
 state=state.update({changes:{from:7,to:8},annotations:Transaction.userEvent.of('delete')}).state;
 assert.equal(state.doc.toString(),'before\n:::inkflit list\nitem\n:::end');
 const unsafe=state.update({changes:{from:3,to:7},annotations:Transaction.userEvent.of('delete')}).state;
 assert.equal(unsafe.doc.toString(),'bef\n:::inkflit list\nitem\n:::end');
});

test('first cursor position and insertions preserve hidden block markers',async()=>{
 const {EditorState,Transaction}=await import('@codemirror/state');
 const {blockProtection,nearestEditablePosition}=await import('../web/block-protection.js');
 const doc=':::inkflit math\n3+4=\n:::end';
 const state=EditorState.create({doc,extensions:[blockProtection]});
 assert.equal(nearestEditablePosition(state.doc,0,0,true),doc.indexOf('3+4'));
 for(const from of [0,14]) {
   const result=state.update({changes:{from,insert:'x'},annotations:Transaction.userEvent.of('input.type')});
   assert.equal(result.state.doc.toString(),doc);
 }
});

test('copy excludes only structural markers and keeps code text',async()=>{
 const {EditorState}=await import('@codemirror/state'); const {visibleCopiedText}=await import('../web/block-protection.js');
 const text=':::inkflit list\n苹果\n梨\n:::end\n段落\n```text\n:::end\n```';
 const state=EditorState.create({doc:text,selection:{anchor:0,head:text.length}});
 assert.equal(visibleCopiedText(text,state),'苹果\n梨\n段落\n```text\n:::end\n```');
});
test('cross-block deletion preserves marker lines and allows undo',async()=>{
 const {EditorState,Transaction}=await import('@codemirror/state');const {history,undo}=await import('@codemirror/commands');const {blockProtection}=await import('../web/block-protection.js');
 const doc=':::inkflit list\n苹果\n:::end\n中间\n:::inkflit math\n2+3=\n:::end\n结尾';
 let state=EditorState.create({doc,extensions:[history(),blockProtection]});
 state=state.update({changes:{from:doc.indexOf('苹果'),to:doc.indexOf(':::end',doc.indexOf('2+3='))},annotations:Transaction.userEvent.of('delete')}).state;
 assert.equal(state.doc.toString(),':::inkflit list\n\n:::end\n\n:::inkflit math\n\n:::end\n结尾');
 let restored=state; assert.equal(undo({state,dispatch:tr=>restored=tr.state}),true); assert.equal(restored.doc.toString(),doc);
});


test('pasting over a cross-block selection replaces text without removing block boundaries',async()=>{
 const {EditorState,Transaction}=await import('@codemirror/state');const {history,undo}=await import('@codemirror/commands');const {blockProtection}=await import('../web/block-protection.js');
 const doc=':::inkflit list\n苹果\n:::end\n中间\n:::inkflit math\n2+3=\n:::end\n结尾';
 let state=EditorState.create({doc,extensions:[history(),blockProtection]});
 state=state.update({changes:{from:doc.indexOf('苹果'),to:doc.indexOf(':::end',doc.indexOf('2+3=')),insert:'新内容'},annotations:Transaction.userEvent.of('input.paste')}).state;
 assert.equal(state.doc.toString(),':::inkflit list\n新内容\n:::end\n\n:::inkflit math\n\n:::end\n结尾');
 let restored=state; assert.equal(undo({state,dispatch:tr=>restored=tr.state}),true); assert.equal(restored.doc.toString(),doc);
});

test('moving upward into a block lands on the last grapheme',async()=>{
 const {EditorState}=await import('@codemirror/state');const {nearestEditablePosition}=await import('../web/block-protection.js');
 const doc=':::inkflit list\n梨👩‍💻\n:::end\n段落';
 const state=EditorState.create({doc});const marker=doc.indexOf(':::end');
 assert.equal(nearestEditablePosition(state.doc,marker,doc.length,false),doc.indexOf('👩'));
});

test('cursor crosses adjacent block markers without landing on a marker',async()=>{
 const {EditorState}=await import('@codemirror/state');
 const {nearestEditablePosition}=await import('../web/block-protection.js');
 const doc=':::inkflit sum\n12\n\n:::end\n:::inkflit list\nfirst\n:::end';
 const state=EditorState.create({doc});
 const second=doc.indexOf(':::inkflit list'), firstEnd=doc.indexOf(':::end');
 assert.equal(nearestEditablePosition(state.doc,second,doc.indexOf('first'),false),doc.indexOf('\n\n')+1);
 assert.equal(nearestEditablePosition(state.doc,firstEnd,doc.indexOf('12'),false),doc.indexOf('first'));
});

test('delete block shortcut targets one complete block and can be undone',async()=>{
 const {EditorState}=await import('@codemirror/state');
 const {history,undo}=await import('@codemirror/commands');
 const {blockProtection}=await import('../web/block-protection.js');
 const {deleteCurrentBlock}=await import('../web/block-menu.js');
 const doc='before\n:::inkflit list\napple\n:::end\n:::inkflit math\n2+3=\n:::end\nafter';
 let state=EditorState.create({doc,selection:{anchor:doc.indexOf('apple')},extensions:[history(),blockProtection]});
 const view={get state(){return state},dispatch:spec=>{state=state.update(spec).state},focus(){}};
 assert.equal(deleteCurrentBlock(view),true);
 assert.equal(state.doc.toString(),'before\n:::inkflit math\n2+3=\n:::end\nafter');
 let restored=state;assert.equal(undo({state,dispatch:tr=>restored=tr.state}),true);assert.equal(restored.doc.toString(),doc);
 state=EditorState.create({doc,selection:{anchor:0},extensions:[history(),blockProtection]});
 assert.equal(deleteCurrentBlock(view),false);assert.equal(state.doc.toString(),doc);
 const broken=':::inkflit list\nunfinished';
 state=EditorState.create({doc:broken,selection:{anchor:broken.length},extensions:[history(),blockProtection]});
 assert.equal(deleteCurrentBlock(view),false);assert.equal(state.doc.toString(),broken);
});

test('block switch shortcut only targets one complete feature block',async()=>{
 const {EditorState}=await import('@codemirror/state');
 const {currentBlockScope}=await import('../web/block-menu.js');
 const doc='plain\n:::inkflit code javascript\nconst a=1;\n:::end\n:::inkflit list\nitem\n:::end\nafter';
 let state=EditorState.create({doc,selection:{anchor:doc.indexOf('const')}});
 assert.equal(currentBlockScope(state).mode,'code');
 state=EditorState.create({doc,selection:{anchor:doc.indexOf('item')}});
 assert.equal(currentBlockScope(state).mode,'list');
 state=EditorState.create({doc,selection:{anchor:doc.indexOf('plain')}});
 assert.equal(currentBlockScope(state),null);
 state=EditorState.create({doc,selection:{anchor:doc.indexOf('const'),head:doc.indexOf('item')+2}});
 assert.equal(currentBlockScope(state),null);
 const unfinished=':::inkflit code\nunfinished';
 state=EditorState.create({doc:unfinished,selection:{anchor:unfinished.length}});
 assert.equal(currentBlockScope(state),null);
});

test('adjacent text lines can be opened above or below a feature block and undone',async()=>{
 const {EditorState}=await import('@codemirror/state');
 const {history,undo,redo}=await import('@codemirror/commands');
 const {blockProtection}=await import('../web/block-protection.js');
 const {planAdjacentBlockLine}=await import('../web/block-menu.js');
 for(const [doc,above,expected,anchor] of [
   [':::inkflit code json\n{}\n:::end',true,'\n:::inkflit code json\n{}\n:::end',0],
   [':::inkflit code json\n{}\n:::end',false,':::inkflit code json\n{}\n:::end\n',31],
   ['before\n:::inkflit list\nitem\n:::end\nafter',true,'before\n\n:::inkflit list\nitem\n:::end\nafter',7],
   ['before\n:::inkflit list\nitem\n:::end\nafter',false,'before\n:::inkflit list\nitem\n:::end\n\nafter',35]
 ]) {
   let state=EditorState.create({doc,selection:{anchor:doc.indexOf(above && doc.includes('item')?'item':doc.includes('{}')?'{}':'item')},extensions:[history(),blockProtection]});
   const plan=planAdjacentBlockLine(state,above); assert.ok(plan);
   state=state.update(plan).state;
   assert.equal(state.doc.toString(),expected);assert.equal(state.selection.main.head,anchor);
   let next=state;assert.equal(undo({state,dispatch:tr=>next=tr.state}),true);assert.equal(next.doc.toString(),doc);
   state=next;assert.equal(redo({state,dispatch:tr=>next=tr.state}),true);assert.equal(next.doc.toString(),expected);
 }
 const text='outside\n:::inkflit code\nx\n:::end';
 let state=EditorState.create({doc:text,selection:{anchor:0}});assert.equal(planAdjacentBlockLine(state,true),null);
 state=EditorState.create({doc:':::inkflit code\nx',selection:{anchor:16}});assert.equal(planAdjacentBlockLine(state,false),null);
});

test('open plain text lines above and below without crossing block boundaries',async()=>{
 const {EditorState}=await import('@codemirror/state');
 const {history,undo,redo}=await import('@codemirror/commands');
 const {planAdjacentTextLine}=await import('../web/block-menu.js');
 for(const [doc,pos,above,expected,anchor] of [
  ['first\nsecond',2,true,'\nfirst\nsecond',0],
  ['first\nsecond',2,false,'first\n\nsecond',6],
  ['first\nsecond',8,true,'first\n\nsecond',6],
  ['first\nsecond',8,false,'first\nsecond\n',13],
  ['',0,false,'\n',1],
  ['中文\n末尾',1,false,'中文\n\n末尾',3]
 ]) {
  let state=EditorState.create({doc,selection:{anchor:pos},extensions:[history()]});const plan=planAdjacentTextLine(state,above);assert.ok(plan);state=state.update(plan).state;
  assert.equal(state.doc.toString(),expected);assert.equal(state.selection.main.head,anchor);
  let next=state;assert.equal(undo({state,dispatch:t=>next=t.state}),true);assert.equal(next.doc.toString(),doc);
  state=next;assert.equal(redo({state,dispatch:t=>next=t.state}),true);assert.equal(next.doc.toString(),expected);
 }
 for(const doc of [':::inkflit code\nx\n:::end','```js\nx\n```',':::inkflit code\nx']) {
  const state=EditorState.create({doc,selection:{anchor:doc.indexOf('x')}});assert.equal(planAdjacentTextLine(state,true),null);
 }
 const doc='first\n:::inkflit list\nitem\n:::end\nlast';
 assert.equal(planAdjacentTextLine(EditorState.create({doc,selection:{anchor:0,head:doc.length}}),true),null);
});

test('task cursor skips checkbox marker while preserving code and plain text',async()=>{
 const {EditorState}=await import('@codemirror/state');
 const {markdown}=await import('@codemirror/lang-markdown');
 const {taskContentPosition}=await import('../web/tasks.js');
 const doc=':::inkflit list\n[x] finished\n[ ] open\n:::end\n```\n[x] code\n```';
 const state=EditorState.create({doc,extensions:[markdown()]});
 const finished=doc.indexOf('[x]'), open=doc.indexOf('[ ]'), code=doc.lastIndexOf('[x]');
 assert.equal(taskContentPosition(state,finished),finished+4);
 assert.equal(taskContentPosition(state,open+1),open+4);
 assert.equal(taskContentPosition(state,finished+4),finished+4);
 assert.equal(taskContentPosition(state,code),code);
});
import { setLanguage } from '../web/i18n.js';
setLanguage('zh-Hans');

test('math blocks colour numbers, functions, units, currencies, operators, variables and "="',()=>{
 const lines=['price: 80','sqrt(price) * 2 =','5 in to cm =','10 km in mi =','10 USD to CNY =','// note','plain words'];
 const kinds=line=>mathHighlights(lines,new Set(['USD','CNY'])).filter(r=>r.line===line).sort((a,b)=>a.from-b.from).map(r=>`${lines[line].slice(r.from,r.to)}:${r.kind}`);
 assert.deepEqual(kinds(0),['price:variable','::punctuation','80:number']);
 assert.deepEqual(kinds(1),['sqrt:function','(:punctuation','price:variable'
,'):punctuation','*:operator','2:number','=:equals']);
 assert.deepEqual(kinds(2),['5:number','in:unit','to:operator','cm:unit','=:equals'],'"in" after a number is inches');
 assert.deepEqual(kinds(3),['10:number','km:unit','in:operator','mi:unit','=:equals'],'otherwise it converts');
 assert.deepEqual(kinds(4),['10:number','USD:currency','to:operator','CNY:currency','=:equals']);
 assert.deepEqual(kinds(5),['// note:comment']);
 assert.deepEqual(kinds(6),[],'lines without ":" or "=" are notes');
});
test('variable names may use any script',()=>{
 assert.deepEqual(analyze('math\n单价: 80\n数量: 3\n单价 * 数量 =\n合計: 单价 * 数量\n合計 + 10 =').results.map(r=>r.text),['240','250']);
});
test('a whole-note math mode leaves blocks inside it alone',()=>{
 const text='math: Trip\nprice: 80\nprice * 2 =\n:::inkflit list\n2 * 3 =\n:::end\n```js\n1 + 1 =\n```\nprice + 1 =';
 const global=analyzeScopes(text).find(scope=>scope.global);
 assert.deepEqual(global.results.map(r=>[r.line,r.text]),[[3,'160'],[10,'81']]);
 const count=analyzeScopes('count\none two\n:::inkflit list\nthree four five\n:::end').find(scope=>scope.global);
 assert.match(count.summary,/2/,'words inside the list are not counted');
});
