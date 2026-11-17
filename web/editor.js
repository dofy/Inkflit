import { t, setLanguage, lang } from './i18n.js';
import { EditorState, Text, Transaction, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, toggleLineComment } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { codeLanguage } from './code-languages.js';
import { blockProtection, nearestEditablePosition, visibleCopiedText } from './block-protection.js';
import { initBlockMenu, blockMenuOpen, closeBlockMenu, trySlash, updateBlockMenu, handleBlockMenuKey, openMenuAfterInput, deleteCurrentBlock, openCurrentBlockMenu, planAdjacentBlockLine } from './block-menu.js';
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
const newNote = () => ({ id: crypto.randomUUID(), content: '', updated: new Date().toISOString() });
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
  const message=ok ? '' : (error || t('保存失败'));
  $('save').textContent = message; $('save').title=message; $('save').className = ok ? '' : 'error';
};
window.snapshotForFlush = () => state ? {json:JSON.stringify(state), revision:saveRevision} : null;
window.setShortcutLabel = label => { $('shortcut').textContent = label; };
window.setLanguage = value => {
  setLanguage(value); document.documentElement.lang=lang();
  for(const [id,key,shortcut] of [['previous','上一条笔记','⌘['],['next','下一条笔记','⌘]'],['new','新建笔记','⌘N'],['delete','删除笔记','⌘D'],['search','搜索笔记','⌘⇧F']]) {
    $(id).setAttribute('aria-label',t(key)); $(id).title=t(key)+' '+shortcut;
  }
  $('block-menu').setAttribute('aria-label',t('功能块')); $('language-menu').setAttribute('aria-label',t('代码语言'));
  $('search-panel').setAttribute('aria-label',t('搜索笔记')); $('search-input').placeholder=t('搜索所有笔记'); $('search-input').setAttribute('aria-label',t('搜索所有笔记')); $('search-close').setAttribute('aria-label',t('关闭'));
  document.querySelectorAll('.task-checkbox').forEach(box=>box.setAttribute('aria-label',t(box.getAttribute('aria-checked')==='true'?'标记为未完成':'标记为已完成')));
  if(editor) { closeBlockMenu(); closeLanguageMenu(); editor.dispatch({effects:rateEffect.of(null)}); refreshInsights(); }
};
function refreshNav() {
  const index = state.notes.findIndex(n => n.id === state.selected);
  $('position').textContent = `${index + 1} / ${state.notes.length}`;
  $('previous').disabled = index === 0;
  $('next').disabled = index === state.notes.length - 1;
}
function makeState(content) {
  const initial=EditorState.create({doc:content,selection:{anchor:nearestEditablePosition(Text.of(content.split("\n")),0,0,true)},extensions:[
    vimCompartment.of(vimEnabled ? vim() : []), history(), blockProtection, EditorView.clipboardOutputFilter.of(visibleCopiedText), EditorState.transactionFilter.of(tr => {
      if (!mergeFirstInsert || !tr.docChanged || !tr.isUserEvent('input.type')) return tr;
      mergeFirstInsert = false;
      if (tr.annotation(Transaction.userEvent) === 'input.type.compose') return tr;
      return {changes:tr.changes, selection:tr.selection, effects:tr.effects, scrollIntoView:tr.scrollIntoView,
        annotations:[Transaction.userEvent.of('input.type.compose'), ...tr.annotations.filter(a => a.type !== Transaction.userEvent)]};
    }), drawSelection(), highlightActiveLine(), markdown({codeLanguages:codeLanguage}), tasks, features, noteComments, noteHeadings, syntaxHighlighting(defaultHighlightStyle), syntaxHighlighting(markdownColors), syntaxHighlighting(classHighlighter), EditorView.lineWrapping,
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
function createNote() { if (!state) return; const n = newNote(); state.notes.unshift(n); changeEditor(n.id); persist(true); }
function deleteNote() {
  if (!state || !confirm(t('删除这条笔记？可在设置中的回收站恢复。'))) return;
  const deleted = state.selected;
  const saveBeforeDelete=()=>persist(true,(ok,revision)=>{
    if(!ok || !state || state.selected!==deleted)return;
    if(revision<saveRevision) { saveBeforeDelete(); return; }
    const index=state.notes.findIndex(n=>n.id===deleted);
    if(index<0)return;
    state.notes.splice(index,1); if (!state.notes.length) state.notes.push(newNote());
    changeEditor(state.notes[Math.min(index,state.notes.length-1)].id); editorStates.delete(deleted); persist(true);
  });
  saveBeforeDelete();
}
function navigate(direction) { if (!state) return; const index = state.notes.findIndex(n => n.id === state.selected); const next = index + direction; if (next >= 0 && next < state.notes.length) select(state.notes[next].id); }
let searchResults=[], searchIndex=0;
function renderSearch() {
  const list=$('search-results'), query=$('search-input').value;
  searchResults=query.trim()?searchNotes(state?.notes||[],query):(state?.notes||[]).map((note,index)=>({id:note.id,index:index+1,at:0,length:0,snippet:notePreview(note.content) || t('空白笔记')}));
  searchIndex=Math.min(searchIndex,Math.max(0,searchResults.length-1));
  list.replaceChildren();
  if(!searchResults.length) { const empty=document.createElement('div');empty.className='search-empty';empty.textContent=t($('search-input').value.trim()?'没有匹配的笔记':'输入关键词搜索笔记');list.append(empty);return; }
  searchResults.forEach((result,index)=>{
    const button=document.createElement('button');button.type='button';button.className='search-result';button.setAttribute('role','option');button.setAttribute('aria-selected',String(index===searchIndex));
    const number=document.createElement('span');number.className='search-result-index';number.textContent=String(result.index);
    const snippet=document.createElement('span');snippet.className='search-result-snippet';snippet.textContent=result.snippet;
    button.append(number,snippet);button.addEventListener('click',()=>chooseSearch(index));list.append(button);
  });
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});
}
function openSearch(query='') { if(!state)return;closeBlockMenu();closeLanguageMenu();$('search-panel').hidden=false;$('search-input').value=query;searchIndex=0;renderSearch();$('search-input').focus(); }
function closeSearch() { $('search-panel').hidden=true;editor?.focus(); }
function chooseSearch(index) {
  const result=searchResults[index];if(!result)return;
  closeSearch();select(result.id);
  const from=Math.min(result.at,editor.state.doc.length),to=Math.min(from+result.length,editor.state.doc.length);
  editor.dispatch({selection:{anchor:from,head:to},scrollIntoView:true});editor.focus();
}
window.openNoteSearch=openSearch;
window.inkflitSelectNote=id=>{if(state?.notes.some(note=>note.id===id)){select(id);return true;}return false;};
$('search').onclick=()=>openSearch();
$('search-close').onclick=closeSearch;
$('search-input').addEventListener('input',()=>{searchIndex=0;renderSearch();});
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
  if(event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase()==='f') { event.preventDefault();event.stopPropagation();openSearch();return; }
  if(!$('search-panel').hidden) {
    if(event.key==='Escape') {event.preventDefault();event.stopPropagation();closeSearch();return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp') {event.preventDefault();event.stopPropagation();if(searchResults.length){searchIndex=(searchIndex+(event.key==='ArrowDown'?1:-1)+searchResults.length)%searchResults.length;renderSearch();}return;}
    if(event.key==='Enter') {event.preventDefault();event.stopPropagation();chooseSearch(searchIndex);return;}
    return;
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
    let plan=planAdjacentBlockLine(editor.state,event.shiftKey);
    if(plan) {
      event.preventDefault(); event.stopPropagation();
      if(event.repeat)return;
      const cm=getCM(editor);
      if(cm?.state?.vim?.visualMode) { Vim.handleKey(cm,'<Esc>','user'); plan=planAdjacentBlockLine(editor.state,event.shiftKey); }
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
    if (['n','d','[',']','1'].includes(key)) {
      event.preventDefault(); event.stopPropagation();
      if (key === 'n') createNote(); else if (key === 'd') deleteNote(); else if (key === '[') navigate(-1); else if (key === ']') navigate(1); else select(state.notes[0].id);
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
  const describe=note=>({id:note.id,index:state.notes.indexOf(note)+1,content:note.content,updated:note.updated});
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
  if(action==='delete') {
    const deleted=note.id, selected=state.selected===deleted, position=state.notes.indexOf(note);
    state.notes.splice(position,1);if(!state.notes.length)state.notes.push(newNote());
    if(selected)changeEditor(state.notes[Math.min(position,state.notes.length-1)].id);
    editorStates.delete(deleted);
    await new Promise((resolve,reject)=>persist(true,ok=>ok?resolve():reject(new Error('Save failed; changes remain in the editor'))));
    return {deleted:deleted};
  }
  if(!note) {note=newNote();note.content=request.content;state.notes.unshift(note);refreshNav();}
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
  const note = newNote(); note.content = content; state.notes.unshift(note); changeEditor(note.id); persist(true);
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
    if (loaded && (!Array.isArray(loaded.notes) || !loaded.notes.length || !loaded.notes.every(n => typeof n.id === 'string' && typeof n.content === 'string' && typeof n.updated === 'string') || !loaded.notes.some(n => n.id === loaded.selected))) throw new Error(t('笔记文件格式无效'));
    if (loaded) { delete loaded.timer; state = loaded; } else { const n = newNote(); state = {notes:[n],selected:n.id}; }
    changeEditor(state.selected); $('save').textContent = ''; $('save').title = ''; $('save').className = '';
  } catch (error) { $('save').className='error'; $('save').textContent = t('读取失败：')+error.message; $('save').title=$('save').textContent; }
};
window.setLanguage(lang());
if (!window.webkit?.messageHandlers?.quicknote) { const saved = localStorage.getItem('quicknote-test'); window.loadNotesBase64(saved ? btoa(unescape(encodeURIComponent(saved))) : null); }
