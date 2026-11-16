import { blockTypes, scopeAt } from './features.js';
const items = [
  ['list','清单','逐行显示复选框'],['math','计算','算式、变量与单位换算'],
  ['sum','求和','汇总块中的数字'],['avg','平均值','计算块内数字平均值'],
  ['count','计数','统计项目、词和字符'],['code','代码','保留代码并按语言高亮'],
  ['timer','计时器','在块内输入 timer 命令'],['text','普通文本','移除功能，保留内容'],['delete','删除块','删除当前块及内容']
];
let menu, view, active=null;
export function initBlockMenu(element, getView) {
  menu=element; view=getView;
  document.addEventListener('mousedown', event=>{if(active && !menu.contains(event.target) && !event.target.closest?.('.block-type')) closeBlockMenu();});
}
export function blockMenuOpen() { return !!active; }
export function closeBlockMenu() { active=null; if(menu) menu.hidden=true; }
function render(query='') {
  const choices=items.filter(x=>(x[0]!=='delete'||active.scope) && (x[0].includes(query.toLowerCase())||x[1].includes(query)));
  active.choices=choices; active.index=Math.min(active.index,Math.max(0,choices.length-1));
  menu.replaceChildren();
  if(!choices.length) { const e=document.createElement('div');e.className='block-menu-empty';e.textContent='没有匹配的功能块';menu.append(e); return; }
  choices.forEach(([id,name,description],index)=>{
    const b=document.createElement('button'); b.type='button';b.className='block-menu-item';b.setAttribute('role','option');b.setAttribute('aria-selected',String(index===active.index));
    const title=document.createElement('span'); title.textContent=name;
    const detail=document.createElement('small');detail.textContent=description;
    const key=document.createElement('kbd');key.textContent=id;
    b.append(title,detail,key);b.addEventListener('mousedown',e=>e.preventDefault()); b.addEventListener('click',()=>choose(id)); menu.append(b);
  });
}
function position(pos) {
  const editor=view(), coords=editor.coordsAtPos(pos), parent=menu.offsetParent.getBoundingClientRect();
  if(!coords) return;
  const left=Math.max(8,Math.min(coords.left-parent.left,parent.width-280));
  const top=Math.max(8,Math.min(coords.bottom-parent.top+4,parent.height-240));
  menu.style.left=`${left}px`;menu.style.top=`${top}px`;
}
export function openBlockMenu({from, scope=null, trigger=false}) {
  const editor=view(); if(!editor)return;
  active={from,scope,trigger,index:0,choices:[]};menu.hidden=false;render();position(from);
}
export function updateBlockMenu() {
  if(!active?.trigger)return;
  const editor=view(), pos=editor.state.selection.main.head;
  if(pos<active.from+1 || editor.state.doc.lineAt(pos).number!==editor.state.doc.lineAt(active.from).number) return closeBlockMenu();
  const query=editor.state.sliceDoc(active.from,pos);
  if(!/^\/[\w\u4e00-\u9fff]*$/.test(query)) return closeBlockMenu();
  render(query.slice(1));position(active.from);
}
function choose(mode) {
  const editor=view(), doc=editor.state.doc, current=active;
  if(!current)return;
  let changes=[], anchor;
  const triggerTo=current.trigger ? editor.state.selection.main.head : current.from;
  if(current.scope) {
    const scope=current.scope, start=doc.line(scope.start), end=scope.end<=doc.lines ? doc.line(scope.end) : null;
    if(scope.kind!=='block' || !end) {closeBlockMenu();return;}
    if(mode==='delete') {
      changes.push({from:start.from,to:end.to<doc.length?end.to+1:end.to});
      anchor=start.from;
    } else if(mode==='text') {
      changes.push({from:start.from,to:start.to+1},{from:end.from-1,to:end.to});
      if(current.trigger) changes.push({from:current.from,to:triggerTo});
      anchor=start.from;
    } else {
      changes.push({from:start.from,to:start.to,insert:`:::quicknote ${mode}`});
      if(current.trigger) changes.push({from:current.from,to:triggerTo});
      anchor=doc.line(scope.start+1).from;
    }
  } else if(mode==='text') {
    if(current.trigger) changes.push({from:current.from,to:triggerTo});
    anchor=current.from;
  } else {
    const insert=`:::quicknote ${mode}\n\n:::end\n`;
    changes.push({from:current.from,to:triggerTo,insert});anchor=current.from+`:::quicknote ${mode}\n`.length;
  }
  closeBlockMenu();
  const changeSet=editor.state.changes(changes);
  // Map the previous position after a conversion; insertions use their explicit new offset.
  const selection=current.scope ? changeSet.mapPos(anchor,1) : anchor;
  editor.dispatch({changes:changeSet,selection:{anchor:selection},userEvent:'input.block'});editor.focus();
}
export function handleBlockMenuKey(event) {
  if(!active)return false;
  if(event.key==='Escape') { closeBlockMenu();return true; }
  if(event.key==='ArrowDown'||event.key==='ArrowUp') { if(active.choices.length) active.index=(active.index+(event.key==='ArrowDown'?1:-1)+active.choices.length)%active.choices.length; render(active.trigger ? view().state.sliceDoc(active.from+1,view().state.selection.main.head) : '');return true; }
  if(event.key==='Enter') { if(active.choices.length) choose(active.choices[active.index][0]); return true; }
  return false;
}
export function trySlash(event, editor) {
  if(event.key!=='/' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !editor.state.selection.main.empty)return false;
  const pos=editor.state.selection.main.head,line=editor.state.doc.lineAt(pos),scope=scopeAt(editor.state.doc.toString(),line.number);
  if(line.text.trim() || (scope && !scope.global && (scope.kind!=='block'||scope.mode==='code')))return false;
  editor.dispatch({changes:{from:pos,insert:'/'},selection:{anchor:pos+1},userEvent:'input.type'});
  openBlockMenu({from:pos,scope:scope?.kind==='block'?scope:null,trigger:true});return true;
}

// IMEs and WebKit may commit a slash as text without a usable keydown event.
export function openMenuAfterInput(update) {
  if(active || !update.docChanged || !update.transactions.some(t=>t.isUserEvent('input.type'))) return;
  const v=update.view, sel=update.state.selection.main;
  if(!sel.empty || sel.head===0) return;
  const line=update.state.doc.lineAt(sel.head), oldLine=update.startState.doc.lineAt(Math.min(update.startState.selection.main.head,update.startState.doc.length));
  if(line.text.trim() !== '/' || oldLine.text.trim() || update.state.sliceDoc(sel.head-1,sel.head)!=='/')return;
  const scope=scopeAt(update.state.doc.toString(),line.number);
  if(scope && !scope.global && (scope.kind!=='block' || scope.mode==='code'))return;
  const from=sel.head-1;
  queueMicrotask(()=>{
    if(active || view()!==v || v.state.doc.lineAt(Math.min(from,v.state.doc.length)).text.trim()!=='/' || v.state.selection.main.head!==from+1)return;
    openBlockMenu({from,scope:scope?.kind==='block'?scope:null,trigger:true});
  });
}
