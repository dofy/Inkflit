import { t, setLanguage, lang } from './i18n.js';
import { EditorState, Text, Transaction, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, toggleLineComment } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { codeLanguage } from './code-languages.js';
import { blockProtection, nearestEditablePosition, visibleCopiedText } from './block-protection.js';
import { initBlockMenu, blockMenuOpen, closeBlockMenu, trySlash, updateBlockMenu, handleBlockMenuKey, openMenuAfterInput, deleteCurrentBlock, openCurrentBlockMenu, planAdjacentBlockLine, planAdjacentTextLine } from './block-menu.js';
import { initLanguageMenu, languageMenuOpen, closeLanguageMenu, handleLanguageMenuKey, openCurrentLanguageMenu } from './language-menu.js';
import { tasks, taskContentPosition } from './tasks.js';
import { features, analyzeCurrent, setRateListener, rateEffect } from './feature-view.js';
import { scopeAt } from './features.js';
import { commentChanges, blockCodeCommentChanges, isCodeAt, noteComments, selectedLines } from './comments.js';
import { noteHeadings } from './typography.js';
import { planCodeEdit, normalizeIndentation } from './code-editing.js';
import { planListIndent } from './list-editing.js';
import { classHighlighter, tags } from '@lezer/highlight';
import { applyCodeTheme } from './code-themes.js';
import { applyUIAppearance } from './ui-themes.js';
import { searchNotes, notePreview } from './note-search.js';
import { filterCommands } from './command-palette.js';
import { createPalette } from './palette.js';

const $ = id => document.getElementById(id);
const markdownColors=HighlightStyle.define([
  {tag:tags.meta,class:'inkflit-md-meta'},
  {tag:tags.url,class:'inkflit-md-url'}
],{scope:markdownLanguage});
let state = null, editor = null;
let saveRevision = 0;
const saveCallbacks = new Map();
let keyStartDoc = null, mergeFirstInsert = false;
let codeIndentation = 'spaces2';
let vimEnabled = true;
const vimCompartment = new Compartment();
const isEditing = () => !vimEnabled || !!getCM(editor)?.state?.vim?.insertMode;
const editorStates = new Map();
const newNote = () => { const now = new Date().toISOString(); return { id: crypto.randomUUID(), content: '', created: now, updated: now }; };
const current = () => state.notes.find(n => n.id === state.selected);
function reportToolbarRegions() {
  const handler=window.webkit?.messageHandlers?.quicknote;
  if(!handler)return;
  const rects=['previous','next','new','delete','search'].map(id=>{
    const r=$(id).getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  });
  handler.postMessage({type:'toolbarRegions',width:document.documentElement.clientWidth,rects});
}
const toolbarObserver=new ResizeObserver(reportToolbarRegions);
for(const element of document.querySelectorAll('header, .nav, .actions, header button, #position')) toolbarObserver.observe(element);
window.addEventListener('resize',reportToolbarRegions);
reportToolbarRegions();
function persist(force=false, onResult=null) {
  const revision=++saveRevision, json=JSON.stringify(state);
  if(onResult) saveCallbacks.set(revision,onResult);
  if (window.webkit?.messageHandlers?.quicknote) window.webkit.messageHandlers.quicknote.postMessage({type:'save', json, revision, force});
  else { try { localStorage.setItem('quicknote-test', json); window.saveResult(true, null, revision); } catch(error) { window.saveResult(false, error.message, revision); } }
}
window.saveResult = (ok, error, revision) => {
  const callback=saveCallbacks.get(revision);
  if(callback) { saveCallbacks.delete(revision); callback(ok,revision); }
  if(Number.isInteger(revision) && revision<saveRevision)return;
  const message=ok ? '' : (error || t('error.saveFailed'));
  $('save').textContent = message; $('save').title=message; $('save').className = ok ? '' : 'error';
};
window.snapshotForFlush = () => state ? {json:JSON.stringify(state), revision:saveRevision} : null;
window.setShortcutLabel = label => { $('shortcut').textContent = label; };
window.setLanguage = value => {
  setLanguage(value); document.documentElement.lang=lang();
  for(const [id,key,shortcut] of [['previous','note.previous','⌘['],['next','note.next','⌘]'],['new','note.new','⌘N'],['delete','note.delete','⌘D'],['search','palette.searchNotes','⌘⇧F']]) {
    $(id).setAttribute('aria-label',t(key)); $(id).title=t(key)+' '+shortcut;
  }
  $('block-menu').setAttribute('aria-label',t('block.menuLabel')); $('language-menu').setAttribute('aria-label',t('editor.codeLanguage'));
  $('search-panel').setAttribute('aria-label',t('palette.searchNotes')); $('search-input').placeholder=t('palette.searchAllNotes'); $('search-input').setAttribute('aria-label',t('palette.searchAllNotes')); $('search-hint').textContent=t('palette.chooseNote');
  $('command-panel').setAttribute('aria-label',t('palette.commandPalette'));$('command-input').placeholder=t('palette.searchCommands');$('command-input').setAttribute('aria-label',t('palette.searchCommands'));$('command-hint').textContent=t('palette.chooseCommand');
  if(commandPalette.open)commandPalette.render();
  if(searchPalette.open)searchPalette.render();
  document.querySelectorAll('.task-checkbox').forEach(box=>box.setAttribute('aria-label',t(box.getAttribute('aria-checked')==='true'?'editor.markIncomplete':'editor.markComplete')));
  updateDeleteNotices();
  if(editor) { closeBlockMenu(); closeLanguageMenu(); editor.dispatch({effects:rateEffect.of(null)}); refreshInsights(); }
};
let createdFormatter=null, createdFormatterLang='';
// Local time in the app language; rebuilt only when the language changes.
function createdFormat() {
  if(createdFormatterLang!==lang()) { createdFormatterLang=lang(); createdFormatter=new Intl.DateTimeFormat(createdFormatterLang,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}); }
  return createdFormatter;
}
function refreshNav() {
  const index = state.notes.findIndex(n => n.id === state.selected);
  $('position').textContent = `${index + 1} / ${state.notes.length}`;
  const created = new Date(state.notes[index]?.created ?? NaN);
  $('created').hidden = isNaN(created);
  $('created').textContent = isNaN(created) ? '' : createdFormat().format(created);
  $('previous').disabled = index === 0;
  $('next').disabled = index === state.notes.length - 1;
}
// Like Vim's scrolloff=3: keep three lines visible beyond the cursor while
// there is content past the viewport; at the ends CodeMirror clamps naturally.
const scrollOff=EditorView.scrollMargins.of(view => { const margin=view.defaultLineHeight*3; return {top:margin, bottom:margin}; });
function makeState(content) {
  const initial=EditorState.create({doc:content,selection:{anchor:nearestEditablePosition(Text.of(content.split("\n")),0,0,true)},extensions:[
    vimCompartment.of(vimEnabled ? vim() : []), history(), blockProtection, EditorView.clipboardOutputFilter.of(visibleCopiedText), EditorState.transactionFilter.of(tr => {
      if (!mergeFirstInsert || !tr.docChanged || !tr.isUserEvent('input.type')) return tr;
      mergeFirstInsert = false;
      if (tr.annotation(Transaction.userEvent) === 'input.type.compose') return tr;
      return {changes:tr.changes, selection:tr.selection, effects:tr.effects, scrollIntoView:tr.scrollIntoView,
        annotations:[Transaction.userEvent.of('input.type.compose'), ...tr.annotations.filter(a => a.type !== Transaction.userEvent)]};
    }), drawSelection(), highlightActiveLine(), markdown({codeLanguages:codeLanguage}), tasks, features, noteComments, noteHeadings, syntaxHighlighting(defaultHighlightStyle), syntaxHighlighting(markdownColors), syntaxHighlighting(classHighlighter), EditorView.lineWrapping, scrollOff,
    keymap.of([...defaultKeymap,...historyKeymap]),
    EditorView.updateListener.of(update => { if(languageMenuOpen() && (update.docChanged || update.selectionSet))closeLanguageMenu(); if (!update.docChanged || !state) return; current().content = update.state.doc.toString(); current().updated = new Date().toISOString(); refreshInsights(); updateBlockMenu(); if(isEditing()) openMenuAfterInput(update); persist(); })
  ]});
  const position=taskContentPosition(initial,initial.selection.main.head);
  return position===initial.selection.main.head ? initial : initial.update({selection:{anchor:position}}).state;
}
initBlockMenu($('block-menu'),()=>editor);
initLanguageMenu($('language-menu'),()=>editor);
function changeEditor(id) {
  closeBlockMenu(); closeLanguageMenu();
  if (editor) { editorStates.set(state.selected, editor.state); editor.destroy(); }
  state.selected = id;
  editor = new EditorView({parent:$('editor'), state:editorStates.get(id) || makeState(current().content)});
  bindVimMode();
  refreshNav(); refreshInsights(); editor.focus();
}
function bindVimMode() {
  $('mode').hidden = !vimEnabled;
  const cm = getCM(editor);
  if (!vimEnabled || !cm) {
    if (window.webkit?.messageHandlers?.quicknote) window.prompt('quicknote-input-mode', 'insert');
    return;
  }
  cm.on('vim-mode-change', event => {
    if (event.mode === 'insert') mergeFirstInsert = !!keyStartDoc && editor.state.doc !== keyStartDoc;
    else mergeFirstInsert = false;
    const mode = event.mode || 'normal';
    $('mode').textContent = String(mode).toUpperCase();
    // Wait for the native input source switch before the next keystroke can
    // reach the IME; a queued message can race with fast Vim/pinyin input.
    if (window.webkit?.messageHandlers?.quicknote) window.prompt('quicknote-input-mode', mode);
  });
  $('mode').textContent = 'NORMAL';
  if (window.webkit?.messageHandlers?.quicknote) window.prompt('quicknote-input-mode', 'normal');
}
function select(id) { if (!state || state.selected === id) return; changeEditor(id); persist(true); }
function createNote() { if (!state) return; const n = newNote(); state.notes.push(n); changeEditor(n.id); persist(true); }
const deleteNotices = new Map();
let deletionQueue=0, deleting=false, deleteOrder=[], placeholderID=null, noticeTimer=null;
function syncDeleteOrder() {
  const active=state.notes.map(note=>note.id), available=new Set([...active,...deleteNotices.keys()]);
  deleteOrder=deleteOrder.filter(id=>available.has(id));
  for(let i=0;i<active.length;i++) {
    const id=active[i];if(deleteOrder.includes(id))continue;
    const next=active.slice(i+1).find(value=>deleteOrder.includes(value));
    const previous=active.slice(0,i).reverse().find(value=>deleteOrder.includes(value));
    const at=next ? deleteOrder.indexOf(next) : previous ? deleteOrder.indexOf(previous)+1 : deleteOrder.length;
    deleteOrder.splice(at,0,id);
  }
}
function updateDeleteNotices() {
  const now=Date.now();
  for(const [id,entry] of deleteNotices) {
    const remaining=Math.max(0,Math.ceil((entry.expires-now)/1000));
    if(!remaining) {entry.element.remove();deleteNotices.delete(id);continue;}
    entry.label.textContent=`${t('note.deleted')} · ${id.slice(0,6)}`;
    entry.time.textContent=`${remaining}${t('note.secondsUnit')}`;
    entry.button.setAttribute('aria-label',`${t('note.undo')} ${entry.title}`);
  }
  const next=[...deleteNotices.keys()].at(-1);
  for(const [id,entry] of deleteNotices) {
    const highlighted=id===next;entry.element.classList.toggle('is-next',highlighted);
    entry.button.textContent=t('note.undo')+(highlighted?' ⌘U':'');
    entry.button.title=highlighted ? '⌘U' : '';
  }
  if(!deleteNotices.size && noticeTimer) {clearInterval(noticeTimer);noticeTimer=null;}
}
function addDeleteNotice(note, savedEditor, placeholder) {
  const element=document.createElement('div');element.className='delete-notice';
  const copy=document.createElement('div');copy.className='delete-notice-copy';
  const label=document.createElement('div');label.className='delete-notice-label';
  const title=document.createElement('div');title.className='delete-notice-title';
  const display=Array.from(notePreview(note.content).trim() || t('note.empty')).slice(0,80).join(''); title.textContent=display;
  const time=document.createElement('span');time.className='delete-notice-time';
  const button=document.createElement('button');button.type='button';button.className='delete-notice-undo';
  button.addEventListener('mousedown',event=>event.preventDefault());
  button.addEventListener('click',()=>restoreDeletedNote(note.id));
  copy.append(label,title);element.append(copy,time,button);$('delete-notices').prepend(element);$('delete-notices').scrollTop=0;
  deleteNotices.set(note.id,{note,savedEditor,placeholder,title:display,element,label,time,button,expires:Date.now()+12000});
  if(!noticeTimer)noticeTimer=setInterval(updateDeleteNotices,250);updateDeleteNotices();
}
function restoreDeletedNote(id) {
  const entry=deleteNotices.get(id);if(!entry || entry.expires<=Date.now() || !state)return;
  if(state.notes.some(note=>note.id===id)) {entry.element.remove();deleteNotices.delete(id);updateDeleteNotices();return;}
  syncDeleteOrder();
  const placeholderIndex=entry.placeholder ? state.notes.findIndex(note=>note.id===entry.placeholder && !note.content) : -1;
  if(placeholderIndex>=0) {state.notes.splice(placeholderIndex,1);if(placeholderID===entry.placeholder)placeholderID=null;}
  const rank=deleteOrder.indexOf(id), next=deleteOrder.slice(rank+1).find(candidate=>state.notes.some(note=>note.id===candidate));
  const previous=deleteOrder.slice(0,rank).reverse().find(candidate=>state.notes.some(note=>note.id===candidate));
  const position=next ? state.notes.findIndex(note=>note.id===next) : previous ? state.notes.findIndex(note=>note.id===previous)+1 : state.notes.length;
  state.notes.splice(position,0,entry.note);if(entry.savedEditor)editorStates.set(id,entry.savedEditor);
  changeEditor(id);if(placeholderIndex>=0)editorStates.delete(entry.placeholder);
  entry.element.remove();deleteNotices.delete(id);updateDeleteNotices();persist(true);
}
function deleteNote() {
  if(!state)return;
  deletionQueue++;processDeletionQueue();
}
function processDeletionQueue() {
  if(deleting || !state || deletionQueue===0)return;
  deletionQueue--;deleting=true;
  const deleted=state.selected;
  if(state.notes.length===1 && deleted===placeholderID && !current().content) {deletionQueue=0;deleting=false;return;}
  const saveBeforeDelete=()=>persist(true,(ok,revision)=>{
    if(!ok || !state || state.selected!==deleted) {deletionQueue=0;deleting=false;return;}
    if(revision<saveRevision) {saveBeforeDelete();return;}
    const index=state.notes.findIndex(note=>note.id===deleted);
    if(index<0) {deletionQueue=0;deleting=false;return;}
    syncDeleteOrder();
    const [note]=state.notes.splice(index,1);let placeholder=null;
    if(!state.notes.length) {const empty=newNote();placeholder=placeholderID=empty.id;state.notes.push(empty);}
    changeEditor(state.notes[Math.min(index,state.notes.length-1)].id);
    const savedEditor=editorStates.get(deleted);editorStates.delete(deleted);
    addDeleteNotice(note,savedEditor,placeholder);
    persist(true,success=>{if(!success)deletionQueue=0;deleting=false;processDeletionQueue();});
  });
  saveBeforeDelete();
}
function navigate(direction) { if (!state) return; const index = state.notes.findIndex(n => n.id === state.selected); const next = index + direction; if (next >= 0 && next < state.notes.length) select(state.notes[next].id); }
const searchPalette=createPalette({
  id:'search',
  rows:query=>query.trim()?searchNotes(state?.notes||[],query):(state?.notes||[]).map((note,index)=>({id:note.id,index:index+1,at:0,length:0,snippet:notePreview(note.content) || t('note.empty')})),
  renderRow:(row,result)=>{
    row.classList.add('search-result');
    const number=document.createElement('span');number.className='palette-row-index';number.textContent=String(result.index);
    const snippet=document.createElement('span');snippet.className='palette-row-title';snippet.textContent=result.snippet;
    row.append(number,snippet);
  },
  empty:query=>t(query.trim()?'palette.noMatchingNotes':'palette.typeToSearch'),
  choose:result=>{
    select(result.id);
    const from=Math.min(result.at,editor.state.doc.length),to=Math.min(from+result.length,editor.state.doc.length);
    editor.dispatch({selection:{anchor:from,head:to},scrollIntoView:true});editor.focus();
  },
  closed:()=>editor?.focus()
});
function openSearch(query='') { if(!state)return;closeBlockMenu();closeLanguageMenu();commandPalette.close();searchPalette.show(query); }
function nativeCommand(action,value) { window.webkit?.messageHandlers?.quicknote?.postMessage({type:'command',action,...(value===undefined?{}:{value})}); }
function availableCommands() {
  const note=t('note.notes'), setting=t('settings.title');
  const commands=[
    {label:t('note.new'),group:note,shortcut:'⌘N',aliases:['new create note'],run:createNote},
    {label:t('palette.searchNotes'),group:note,shortcut:'⌘⇧F',aliases:['search find note'],run:()=>openSearch()},
    {label:t('note.previous'),group:note,shortcut:'⌘[',aliases:['previous note'],run:()=>navigate(-1)},
    {label:t('note.next'),group:note,shortcut:'⌘]',aliases:['next note'],run:()=>navigate(1)},
    {label:t('note.delete'),group:note,shortcut:'⌘D',aliases:['delete note trash'],run:deleteNote},
    {label:t('palette.openSettings'),group:setting,shortcut:'⌘,',aliases:['settings preferences'],run:()=>nativeCommand('settings')},
    {label:t(vimEnabled?'palette.disableVim':'palette.enableVim'),group:setting,aliases:['vim mode toggle'],run:()=>nativeCommand('toggle-vim')}
  ];
  if(deleteNotices.size)commands.splice(5,0,{label:t('note.restoreLastDeleted'),group:note,shortcut:'⌘U',aliases:['restore undo deleted note'],run:()=>{updateDeleteNotices();const id=[...deleteNotices.keys()].at(-1);if(id)restoreDeletedNote(id);}});
  // Options with several values open a second level of the palette.
  // `current` marks the value reported by the native side (see setCommandState).
  const choices=(action,pairs)=>()=>pairs.map(([value,label])=>({label:t(label),aliases:[value],current:commandState[action]===value,run:()=>nativeCommand(action,value)}));
  // Presets plus the current value when it is not one of them.
  const withCurrent=(values,action)=>{ const current=Number(commandState[action]);return Number.isInteger(current) && !values.includes(current) ? [...values,current].sort((a,b)=>b-a) : values; };
  const percent=(action,values,min,max)=>Object.assign(()=>withCurrent(values,action).map(value=>({label:`${value}%`,aliases:[String(value)],current:commandState[action]===String(value),run:()=>nativeCommand(action,String(value))})),{
    typed:query=>{ const value=Number(query.trim().replace(/%$/,'')); return Number.isInteger(value) && value>=min && value<=max ? {label:`${value}%`,run:()=>nativeCommand(action,String(value))} : null; }
  });
  const versions=count=>t('palette.keepVersions').replace('%d',String(count));
  const backups=Object.assign(()=>[
    {label:t('settings.off'),aliases:['off'],current:commandState.backup==='off',run:()=>nativeCommand('backup','off')},
    {label:t('settings.backupUnlimited'),aliases:['unlimited'],current:commandState.backup==='unlimited',run:()=>nativeCommand('backup','unlimited')},
    ...withCurrent([10,20,50,100],'backup').sort((a,b)=>a-b).map(count=>({label:versions(count),aliases:[String(count)],current:commandState.backup===String(count),run:()=>nativeCommand('backup',String(count))}))
  ],{typed:query=>{ const count=Number(query.trim()); return Number.isInteger(count) && count>=1 && count<=1_000_000 ? {label:versions(count),run:()=>nativeCommand('backup',String(count))} : null; }});
  commands.push(
    {label:t('settings.accentColor'),group:setting,aliases:['appearance accent theme color'],children:choices('ui-theme',[['orange','settings.themeWarmOrange'],['blue','settings.themeOceanBlue'],['green','settings.themeSage']])},
    {label:t('settings.codeColors'),group:setting,aliases:['code syntax theme'],children:choices('code-theme',[['amber','settings.themeAmber'],['ocean','settings.themeOceanBlue'],['contrast','settings.themeVivid']])},
    {label:t('settings.codeIndentation'),group:setting,aliases:['code indentation indent'],children:choices('indent',[['spaces2','settings.indentTwoSpaces'],['spaces4','settings.indentFourSpaces'],['tabs','Tab']])},
    {label:t('settings.language'),group:setting,aliases:['language locale'],children:choices('language',[['system','settings.languageSystem'],['en','English'],['zh-Hans','简体中文'],['zh-Hant','繁體中文'],['ja','日本語']])},
    {label:t('settings.windowOpacity'),group:setting,aliases:['window opacity transparency'],children:percent('opacity',[100,90,80,70,60,50],50,100)},
    {label:t('settings.backgroundBlur'),group:setting,aliases:['background blur'],children:percent('blur',[0,20,40,60,80,100],0,100)},
    {label:t('settings.automaticBackups'),group:setting,aliases:['automatic backup versions'],children:backups},
    {label:t('settings.launchAtLogin'),group:setting,aliases:['launch at login startup'],children:choices('login',[['on','palette.on'],['off','settings.off']])},
    {label:t('settings.restoreGuideNotes'),group:setting,aliases:['restore guide notes onboarding'],run:()=>nativeCommand('onboarding')},
    {label:t('settings.openHelp'),group:setting,aliases:['help guide documentation'],run:()=>nativeCommand('help')}
  );
  return commands;
}
// First level: the commands, or while typing also every second-level option
// ("Language: English") so a value can be reached in one step.
function commandRows(query, parent) {
  if(parent) {
    const options=parent.children(), typed=parent.children.typed?.(query);
    const matches=filterCommands(options,query);
    return typed && !matches.some(option=>option.label===typed.label) ? [typed,...matches] : matches;
  }
  const commands=availableCommands();
  if(!query.trim())return commands;
  const flattened=commands.flatMap(command=>command.children ? command.children().map(option=>({...option,label:`${command.label}：${option.label}`,group:command.group,aliases:[...(command.aliases||[]),...(option.aliases||[])]})) : []);
  return filterCommands([...commands,...flattened],query);
}
const commandPalette=createPalette({
  id:'command',
  rows:commandRows,
  renderRow:(row,command)=>{
    row.classList.add('command-row');
    const title=document.createElement('span');title.className='palette-row-title';title.textContent=command.label;
    const group=document.createElement('span');group.className='palette-row-group';group.textContent=command.group;
    row.append(title);if(command.group)row.append(group);
    if(command.shortcut){const shortcut=document.createElement('kbd');shortcut.textContent=command.shortcut;row.append(shortcut);}
    if(command.current){row.setAttribute('aria-current','true');const check=document.createElement('span');check.className='palette-row-check';check.textContent='✓';row.append(check);}
    if(command.children){const more=document.createElement('span');more.className='palette-row-more';more.textContent='›';row.append(more);}
  },
  empty:()=>t('palette.noMatchingCommands'),
  levelChanged:parent=>{ $('command-hint').textContent=parent ? t(parent.children.typed?'palette.chooseOrTypeNumber':'palette.chooseOption') : t('palette.chooseCommand'); },
  choose:command=>command.run(),
  closed:()=>editor?.focus()
});
let commandState={};
// The native side answers a 'state' request with the current settings, keyed
// by the same action names the commands send.
window.setCommandState=value=>{ commandState=value && typeof value==='object' ? value : {};if(commandPalette.open)commandPalette.render(); };
function openCommands() { if(!state)return;closeBlockMenu();closeLanguageMenu();searchPalette.close();nativeCommand('state');commandPalette.show(); }
window.openCommands=openCommands;
window.openNoteSearch=openSearch;
window.inkflitSelectNote=id=>{if(state?.notes.some(note=>note.id===id)){select(id);return true;}return false;};
$('search').onclick=()=>{ if(searchPalette.open)searchPalette.close();else openSearch(); };
function hide() { if (window.webkit?.messageHandlers?.quicknote) window.webkit.messageHandlers.quicknote.postMessage({type:'hide'}); else window.quicknoteHideRequested = (window.quicknoteHideRequested || 0) + 1; }
$('new').onclick = createNote; $('delete').onclick = deleteNote; $('previous').onclick = () => navigate(-1); $('next').onclick = () => navigate(1);
function refreshInsights() {
  if (!editor) return;
  const info=analyzeCurrent(editor.state.doc.toString());
  $('insights').textContent=info.summary; $('insights').hidden=!info.summary;
}
setRateListener(()=>{ if(editor) {editor.dispatch({effects:rateEffect.of(null)}); refreshInsights();} });
document.addEventListener('keydown', event => {
  if (!state || event.isComposing || event.keyCode === 229) return;
  // ⌘⇧P and ⌘⇧F toggle their palette from anywhere, switching away from the other one.
  if(event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && ['p','f'].includes(event.key.toLowerCase())) {
    event.preventDefault();event.stopPropagation();if(event.repeat)return;
    const [target,open]=event.key.toLowerCase()==='p' ? [commandPalette,openCommands] : [searchPalette,()=>openSearch()];
    if(target.open)target.close();else open();
    return;
  }
  const palette=commandPalette.open ? commandPalette : searchPalette.open ? searchPalette : null;
  if(palette) {
    if(palette.handleKey(event)) {event.preventDefault();event.stopPropagation();return;}
    // Editor tools at the cursor (⌘L, ⌘O) leave the palette instead of being swallowed.
    if(event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey && ['l','o'].includes(event.key.toLowerCase())) palette.close();
    else return;
  }
  if(event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase()==='u' && deleteNotices.size) {
    updateDeleteNotices();const id=[...deleteNotices.keys()].at(-1);
    if(id) {event.preventDefault();event.stopPropagation();if(!event.repeat)restoreDeletedNote(id);return;}
  }
  keyStartDoc = editor?.state.doc;
  if(event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase()==='l' && editor?.hasFocus) {
    if(!event.repeat && openCurrentLanguageMenu(editor)) {event.preventDefault();event.stopPropagation();}
    return;
  }
  if(event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase()==='k' && editor?.hasFocus) {
    if(!event.repeat && openCurrentBlockMenu(editor)) {closeLanguageMenu();event.preventDefault(); event.stopPropagation();}
    return;
  }
  if(event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase()==='o' && editor?.hasFocus && !blockMenuOpen() && !languageMenuOpen()) {
    let plan=planAdjacentBlockLine(editor.state,event.shiftKey) ?? planAdjacentTextLine(editor.state,event.shiftKey);
    if(plan) {
      event.preventDefault(); event.stopPropagation();
      if(event.repeat)return;
      const cm=getCM(editor);
      if(cm?.state?.vim?.visualMode) { Vim.handleKey(cm,'<Esc>','user'); plan=planAdjacentBlockLine(editor.state,event.shiftKey) ?? planAdjacentTextLine(editor.state,event.shiftKey); }
      if(!plan)return;
      editor.dispatch(plan);
      if(cm && !cm.state.vim?.insertMode) Vim.handleKey(cm,'i','user');
      editor.focus();
    }
    return;
  }
  if(event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase()==='d') {
    event.preventDefault(); event.stopPropagation();
    if(!event.repeat) deleteCurrentBlock(editor);
    return;
  }
  if(languageMenuOpen() && handleLanguageMenuKey(event)) {event.preventDefault();event.stopPropagation();return;}
  if(blockMenuOpen() && handleBlockMenuKey(event)) {event.preventDefault();event.stopPropagation();return;}
  if(!languageMenuOpen() && !blockMenuOpen() && editor?.hasFocus && event.key==='Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const planned=planListIndent(editor.state,event.shiftKey ? 'Shift-Tab' : 'Tab');
    if(planned) {event.preventDefault();event.stopPropagation();editor.dispatch(planned);return;}
    const cm=getCM(editor), mode=cm?.state?.vim;
    if(vimEnabled && mode && !mode.insertMode && !mode.visualMode && !cm.state.dialog) {
      event.preventDefault(); event.stopPropagation(); return;
    }
  }
  if(!languageMenuOpen() && !blockMenuOpen() && editor?.hasFocus && !event.metaKey && !event.ctrlKey && !event.altKey && isEditing()) {
    const key=event.key==='Tab' && event.shiftKey ? 'Shift-Tab' : event.key;
    const planned=planCodeEdit(editor.state,key,{indentation:codeIndentation});
    if(planned) {event.preventDefault();event.stopPropagation();editor.dispatch(planned);return;}
  }
  if(!blockMenuOpen() && isEditing() && trySlash(event,editor)) {event.preventDefault();event.stopPropagation();return;}
  if (event.key.toLowerCase() === 'x' && !event.metaKey && !event.ctrlKey && !event.altKey && isEditing() && scopeAt(editor.state.doc.toString(),editor.state.doc.lineAt(editor.state.selection.main.head).number)?.mode==='list') {
    const sel=editor.state.selection.main, line=editor.state.doc.lineAt(sel.head);
    if (sel.empty && sel.head===line.to && line.text.endsWith('/') && line.number>1 && !/^\s*(?:\/\/|#)/.test(line.text)) {
      const match=/^(\s*(?:(?:[-+*]|\d+[.)])\s+)?)\[([ xX])\](?=\s|$)/.exec(line.text);
      const changes=[{from:line.to-1,to:line.to}];
      if(match) changes.push({from:line.from+match[1].length+1,to:line.from+match[1].length+2,insert:/[xX]/.test(match[2])?' ':'x'});
      else changes.push({from:line.from+/^\s*/.exec(line.text)[0].length,insert:'[x] '});
      event.preventDefault(); event.stopPropagation(); editor.dispatch({changes,userEvent:'input.task.toggle'}); return;
    }
  }
  if (event.key === 'Enter' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && isEditing()) {
    const selection=editor.state.selection.main;
    const line=editor.state.doc.lineAt(selection.head), scope=scopeAt(editor.state.doc.toString(),line.number);
    if(selection.empty && scope?.kind==='block' && scope.mode!=='code' && line.number===scope.end-1 && !line.text.trim() && scope.end<=editor.state.doc.lines) {
      const end=editor.state.doc.line(scope.end);
      event.preventDefault();event.stopPropagation();
      if(end.to===editor.state.doc.length) editor.dispatch({changes:{from:end.to,insert:'\n'},selection:{anchor:end.to+1},userEvent:'input.block.exit'});
      else editor.dispatch({selection:{anchor:end.to+1},scrollIntoView:true});
      return;
    }
  }
  if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    const key = event.key.toLowerCase();
    if (key === 'c' && editor.state.selection.main.empty) {
      const doc=editor.state.doc, line=doc.lineAt(editor.state.selection.main.head);
      const scope=scopeAt(doc.toString(),line.number);
      if(scope?.mode==='code') {
        const from=scope.start<doc.lines ? doc.line(scope.start+1).from : doc.length;
        const to=scope.end<=doc.lines ? doc.line(scope.end).from-1 : doc.length;
        const content=doc.sliceString(from,Math.max(from,to));
        const handler=window.webkit?.messageHandlers?.quicknote;
        if(handler) { event.preventDefault(); event.stopPropagation(); handler.postMessage({type:'copyCode',content}); return; }
        if(navigator.clipboard?.writeText) { event.preventDefault(); event.stopPropagation(); navigator.clipboard.writeText(content).catch(()=>{}); return; }
      }
    }
    if (key === '/') {
      event.preventDefault(); event.stopPropagation();
      const lines = selectedLines(editor.state);
      const customCode = blockCodeCommentChanges(editor.state);
      if(customCode) { if(customCode.length) editor.dispatch({changes:customCode,userEvent:'input.comment'}); return; }
      const inCode = lines.length && lines.every(line => isCodeAt(editor.state, line.from));
      if (!inCode || !toggleLineComment(editor)) {
        const changes = commentChanges(editor.state, {includeCode:!!inCode});
        if (changes.length) editor.dispatch({changes, userEvent:'input.comment'});
      }
      return;
    }
    if (['n','d','[',']'].includes(key) || /^[1-9]$/.test(key)) {
      event.preventDefault(); event.stopPropagation();
      if (key === 'n') createNote(); else if (key === 'd') deleteNote(); else if (key === '[') navigate(-1); else if (key === ']') navigate(1);
      else { const note = state.notes[Number(key) - 1]; if (note) select(note.id); }
      return;
    }
  }
  if (event.key !== 'Escape' || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey || event.repeat) return;
  const cm = getCM(editor); const vimState = cm?.state?.vim; const input = vimState?.inputState;
  const pending = !!(cm?.state?.dialog || vimState?.insertMode || vimState?.visualMode || vimState?.exMode || input?.keyBuffer?.length || input?.operator || input?.motion || input?.repeatOverride || input?.registerName);
  if (!pending) { event.preventDefault(); event.stopPropagation(); hide(); }
}, true);
// Vim yanks bypass CodeMirror's clipboard filter, so filter their selected text too.
const registers=Vim.getRegisterController();
const originalPushText=registers.pushText;
registers.pushText=function(name,operator,text,linewise,blockwise) {
  if(editor && typeof text==='string') text=visibleCopiedText(text,editor.state);
  return originalPushText.call(this,name,operator,text,linewise,blockwise);
};
Vim.defineEx('write', 'w', () => { if (state) persist(true); });
window.focusEditor = () => { if (editor) editor.focus(); };
window.setVimEnabled = value => {
  const enabled = !!value;
  if (enabled === vimEnabled) return;
  vimEnabled = enabled; mergeFirstInsert = false;
  closeBlockMenu(); closeLanguageMenu();
  for (const [id, cached] of editorStates) editorStates.set(id, cached.update({effects:vimCompartment.reconfigure(enabled ? vim() : [])}).state);
  if (editor) { editor.dispatch({effects:vimCompartment.reconfigure(enabled ? vim() : [])}); bindVimMode(); }
};
window.setCodeIndentation = value => { codeIndentation=normalizeIndentation(value); };
let currentCodeTheme='amber', currentUITheme='orange', currentOpacity=100;
window.setCodeTheme = value => { currentCodeTheme=value; applyCodeTheme(value); };
applyCodeTheme('amber');
window.setUIAppearance = (theme, opacity) => { currentUITheme=theme; currentOpacity=opacity; applyUIAppearance(theme, opacity); };
globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change',()=>{
  applyUIAppearance(currentUITheme,currentOpacity); applyCodeTheme(currentCodeTheme);
});
applyUIAppearance('orange',100);
window.exportNotesJSON = () => state ? JSON.stringify(state) : null;
// All external callers use the live editor state and the normal save pipeline.
window.inkflitNotesOperation = async request => {
  if(!state || !request || typeof request !== 'object') throw new Error('Notes are not ready');
  const action=request.action, id=request.id, index=request.index;
  if(id !== undefined && index !== undefined) throw new Error('Specify either id or index, not both');
  const resolveNote=required=>{
    if(id !== undefined) {
      if(typeof id !== 'string' || !id)throw new Error('Invalid note id');
      const note=state.notes.find(n=>n.id===id);if(!note)throw new Error('Note not found');return note;
    }
    if(index !== undefined) {
      if(!Number.isInteger(index) || index<1 || index>state.notes.length)throw new Error('Note index out of range');
      return state.notes[index-1];
    }
    if(required)throw new Error('A note id or 1-based index is required');
    return null;
  };
  const describe=note=>({id:note.id,index:state.notes.indexOf(note)+1,content:note.content,...(note.created?{created:note.created}:{}),updated:note.updated});
  if(action==='list') return {notes:state.notes.map(describe)};
  if(action==='get') return {note:describe(resolveNote(true))};
  if(action==='search') {
    if(typeof request.query!=='string' || !request.query.trim())throw new Error('A search query is required');
    return {results:searchNotes(state.notes,request.query)};
  }
  if(!['create','append','replace','delete'].includes(action))throw new Error('Unknown note operation');
  if(action!=='delete' && (typeof request.content!=='string' || request.content.length>1_000_000))throw new Error('Content must be a string of at most 1000000 characters');
  let note=action==='create'?null:resolveNote(action==='delete');
  if(action==='create' && (id !== undefined || index !== undefined))throw new Error('Create does not take a note target');
  if(action!=='create' && request.position !== undefined)throw new Error('Position is only valid when creating a note');
  let insertion=state.notes.length;
  if(action==='create' && request.position !== undefined) {
    const position=request.position;
    if(position==='last') insertion=state.notes.length;
    else if(position==='first') insertion=0;
    else if(Number.isInteger(position) && position>=1 && position<=state.notes.length+1) insertion=position-1;
    else throw new Error('Position must be first, last, or an insertion index from 1 through note count + 1');
  }
  if(action==='delete') {
    const deleted=note.id, selected=state.selected===deleted, position=state.notes.indexOf(note);
    syncDeleteOrder();state.notes.splice(position,1);let placeholder=null;
    if(!state.notes.length) {const empty=newNote();placeholder=placeholderID=empty.id;state.notes.push(empty);}
    if(selected)changeEditor(state.notes[Math.min(position,state.notes.length-1)].id);else refreshNav();
    const savedEditor=editorStates.get(deleted);editorStates.delete(deleted);addDeleteNotice(note,savedEditor,placeholder);
    await new Promise((resolve,reject)=>persist(true,ok=>ok?resolve():reject(new Error('Save failed; changes remain in the editor'))));
    return {deleted:deleted};
  }
  if(!note) {note=newNote();note.content=request.content;state.notes.splice(insertion,0,note);refreshNav();}
  else {
    const text=action==='append' ? note.content+(note.content && request.content && !note.content.endsWith('\n') && !request.content.startsWith('\n')?'\n':'')+request.content : request.content;
    if(text!==note.content) {
      const spec={changes:{from:0,to:note.content.length,insert:text},annotations:Transaction.userEvent.of('input.external'),filter:false};
      if(note.id===state.selected) editor.dispatch(spec);
      else {const cached=editorStates.get(note.id);if(cached)editorStates.set(note.id,cached.update(spec).state);note.content=text;note.updated=new Date().toISOString();}
    }
  }
  await new Promise((resolve,reject)=>persist(true,ok=>ok?resolve():reject(new Error('Save failed; changes remain in the editor'))));
  return {note:describe(note)};
};
window.restoreNoteBase64 = value => {
  if (!state) throw new Error('No note state');
  const content = new TextDecoder('utf-8', {fatal:true}).decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)));
  const note = newNote(); note.content = content; state.notes.push(note); changeEditor(note.id); persist(true);
};
window.addOnboardingNotesBase64 = value => {
  if (!state) throw new Error('No note state');
  const contents=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0))));
  if(!Array.isArray(contents) || !contents.length || !contents.every(value=>typeof value==='string' && value.trim())) throw new Error('Invalid guide notes');
  const notes=contents.map(content=>({...newNote(),content}));
  state.notes.unshift(...notes); changeEditor(notes[0].id); persist(true);
  return notes.length;
};
window.loadNotesBase64 = value => {
  try {
    const loaded = value ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)))) : null;
    if (loaded && (!Array.isArray(loaded.notes) || !loaded.notes.length || !loaded.notes.every(n => typeof n.id === 'string' && typeof n.content === 'string' && typeof n.updated === 'string') || !loaded.notes.some(n => n.id === loaded.selected))) throw new Error(t('error.invalidNotesFile'));
    if (loaded) { delete loaded.timer; state = loaded; } else { const n = newNote(); state = {notes:[n],selected:n.id}; }
    changeEditor(state.selected); $('save').textContent = ''; $('save').title = ''; $('save').className = '';
  } catch (error) { $('save').className='error'; $('save').textContent = t('error.readFailed')+error.message; $('save').title=$('save').textContent; }
};
window.setLanguage(lang());
if (!window.webkit?.messageHandlers?.quicknote) { const saved = localStorage.getItem('quicknote-test'); window.loadNotesBase64(saved ? btoa(unescape(encodeURIComponent(saved))) : null); }
