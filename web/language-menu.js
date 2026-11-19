import { markerPrefix, scopesOf } from './features.js';
import { t } from './i18n.js';
import { currentBlockScope, closeBlockMenu } from './block-menu.js';

export const languages = [['','editor.plainText'],['javascript','JavaScript'],['typescript','TypeScript'],['python','Python'],['swift','Swift'],['json','JSON'],['html','HTML'],['css','CSS'],['sql','SQL'],['shell','Shell'],['markdown','Markdown']];
let menu, getView, active = null;

export function initLanguageMenu(element, view) {
  menu=element; getView=view;
  document.addEventListener('mousedown', event => {
    if(active && !menu.contains(event.target) && !event.target.closest?.('.block-language')) closeLanguageMenu();
  });
}
export function languageMenuOpen() { return !!active; }
export function closeLanguageMenu() {
  if(active?.button) active.button.setAttribute('aria-expanded','false');
  active=null; if(menu) menu.hidden=true;
}
function render() {
  menu.replaceChildren();
  active.choices.forEach(([value,label], index) => {
    const item=document.createElement('button'); item.type='button'; item.className='language-menu-item';
    item.setAttribute('role','option'); item.setAttribute('aria-selected',String(index===active.index));
    const name=document.createElement('span'); name.textContent=t(label);
    const mark=document.createElement('span'); mark.className='language-menu-check'; mark.textContent=value===active.scope.language?'✓':'';
    item.append(name,mark); item.addEventListener('mousedown',event=>event.preventDefault()); item.addEventListener('click',()=>choose(value)); menu.append(item);
  });
  const selected=menu.querySelector('[aria-selected="true"]');
  if(selected) {
    const top=selected.offsetTop, bottom=top+selected.offsetHeight;
    if(top<menu.scrollTop) menu.scrollTop=top;
    else if(bottom>menu.scrollTop+menu.clientHeight) menu.scrollTop=bottom-menu.clientHeight;
  }
}
function position(editor, scope, button) {
  const parent=menu.offsetParent.getBoundingClientRect();
  const coords=button?.getBoundingClientRect() || editor.coordsAtPos(editor.state.doc.line(scope.start).from) || editor.coordsAtPos(editor.state.selection.main.head);
  if(!coords)return;
  const left=Math.max(8,Math.min(coords.left-parent.left,parent.width-menu.offsetWidth-8));
  const below=coords.bottom-parent.top+4, above=coords.top-parent.top-menu.offsetHeight-4;
  menu.style.left=`${left}px`; menu.style.top=`${below+menu.offsetHeight<=parent.height-8?below:Math.max(8,above)}px`;
}
export function openLanguageMenu(editor, scope, button=null) {
  if(!editor || scope?.mode!=='code' || !(scope.global || (scope.kind==='block' && scope.closed)))return false;
  closeBlockMenu(); closeLanguageMenu();
  const choices=[...languages];
  if(scope.language && !choices.some(([value])=>value===scope.language))choices.push([scope.language,scope.language]);
  active={scope,button,choices,index:Math.max(0,choices.findIndex(([value])=>value===(scope.language||'')))};
  if(button)button.setAttribute('aria-expanded','true');
  menu.hidden=false; render(); position(editor,scope,button); return true;
}
export function currentLanguageScope(state) {
  const global=scopesOf(state.doc).find(item=>item.global);
  // In a whole-note code mode the first line names the language.
  const scope=global?.mode==='code' ? global : currentBlockScope(state);
  return scope?.mode==='code' ? scope : null;
}
export function openCurrentLanguageMenu(editor) {
  const scope=currentLanguageScope(editor.state);
  if(!scope)return false;
  const line=editor.state.doc.line(scope.start);
  const button=[...editor.dom.querySelectorAll('.block-language')].find(el=>editor.state.doc.lineAt(editor.posAtDOM(el)).number===line.number);
  return openLanguageMenu(editor,scope,button);
}
function choose(language) {
  const editor=getView(), current=active;
  if(!editor || !current)return;
  // The selection may be in another block when opened with the mouse.
  const line=editor.state.doc.line(current.scope.start), header=/^(\s*code)(?:\s+[\w+.-]+)?(\s*:.*)?$/i.exec(line.text);
  let insert;
  if(current.scope.global && header) insert=header[1]+(language?' '+language:'')+(header[2]||'');
  else if(!current.scope.global && /^:::inkflit code(?:\s|$)/.test(line.text)) insert=`${markerPrefix} code`+(language?' '+language:'');
  else { closeLanguageMenu(); return; }
  const changes=editor.state.changes({from:line.from,to:line.to,insert});
  closeLanguageMenu();
  editor.dispatch({changes,selection:editor.state.selection.map(changes),userEvent:'input.block.language'}); editor.focus();
}
export function handleLanguageMenuKey(event) {
  if(!active)return false;
  if(event.key==='Escape') {closeLanguageMenu();return true;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp') {
    active.index=(active.index+(event.key==='ArrowDown'?1:-1)+active.choices.length)%active.choices.length;render();return true;
  }
  if(event.key==='Home'||event.key==='End') {active.index=event.key==='Home'?0:active.choices.length-1;render();return true;}
  if(event.key==='Enter') {choose(active.choices[active.index][0]);return true;}
  return false;
}
