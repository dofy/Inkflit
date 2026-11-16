import { t, setLanguage, lang } from './i18n.js';
import { EditorState, Text, Transaction } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, toggleLineComment } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { codeLanguage } from './code-languages.js';
import { blockProtection, nearestEditablePosition, visibleCopiedText } from './block-protection.js';
import { initBlockMenu, blockMenuOpen, closeBlockMenu, trySlash, updateBlockMenu, handleBlockMenuKey, openMenuAfterInput, deleteCurrentBlock, openCurrentBlockMenu } from './block-menu.js';
import { initLanguageMenu, languageMenuOpen, closeLanguageMenu, handleLanguageMenuKey, openCurrentLanguageMenu } from './language-menu.js';
import { tasks, taskContentPosition } from './tasks.js';
import { features, analyzeCurrent, setRateListener, rateEffect } from './feature-view.js';
import { parseTimer, scopeAt } from './features.js';
import { timerCommand, timerDisplay, advanceTimer } from './timer.js';
import { commentChanges, blockCodeCommentChanges, isCodeAt, noteComments, selectedLines } from './comments.js';
import { planCodeEdit, normalizeIndentation } from './code-editing.js';
import { classHighlighter } from '@lezer/highlight';
import { applyCodeTheme } from './code-themes.js';
import { applyUIAppearance } from './ui-themes.js';

const $ = id => document.getElementById(id);
let state = null, editor = null;
let keyStartDoc = null, mergeFirstInsert = false;
let codeIndentation = 'spaces2';
const editorStates = new Map();
const newNote = () => ({ id: crypto.randomUUID(), content: '', updated: new Date().toISOString() });
const current = () => state.notes.find(n => n.id === state.selected);
function persist() {
  $('save').textContent = t('保存中…'); $('save').className = '';
  if (window.webkit?.messageHandlers?.quicknote) window.webkit.messageHandlers.quicknote.postMessage({type:'save', json:JSON.stringify(state)});
  else { localStorage.setItem('quicknote-test', JSON.stringify(state)); window.saveResult(true); }
}
window.saveResult = (ok, error) => { $('save').textContent = ok ? t('已保存') : (error || t('保存失败')); $('save').className = ok ? '' : 'error'; };
window.setShortcutLabel = label => { $('shortcut').textContent = label; };
window.setLanguage = value => {
  setLanguage(value); document.documentElement.lang=lang();
  for(const [id,key,shortcut] of [['previous','上一条笔记','⌘['],['next','下一条笔记','⌘]'],['new','新建笔记','⌘N'],['delete','删除笔记','⌘D']]) {
    $(id).setAttribute('aria-label',t(key)); $(id).title=t(key)+' '+shortcut;
  }
  $('block-menu').setAttribute('aria-label',t('功能块')); $('language-menu').setAttribute('aria-label',t('代码语言'));
  document.querySelectorAll('.task-checkbox').forEach(box=>box.setAttribute('aria-label',t(box.getAttribute('aria-checked')==='true'?'标记为未完成':'标记为已完成')));
  $('timer-reset').textContent=t('重置'); $('timer-stop').textContent=t('停止');
  if(editor) { closeBlockMenu(); closeLanguageMenu(); editor.dispatch({effects:rateEffect.of(null)}); refreshInsights(); renderTimer(); }
  if(state && !$('save').classList.contains('error')) $('save').textContent=t('已保存');
};
function refreshNav() {
  const index = state.notes.findIndex(n => n.id === state.selected);
  $('position').textContent = `${index + 1} / ${state.notes.length}`;
  $('previous').disabled = index === state.notes.length - 1;
  $('next').disabled = index === 0;
}
function makeState(content) {
  const initial=EditorState.create({doc:content,selection:{anchor:nearestEditablePosition(Text.of(content.split("\n")),0,0,true)},extensions:[
    vim(), history(), blockProtection, EditorView.clipboardOutputFilter.of(visibleCopiedText), EditorState.transactionFilter.of(tr => {
      if (!mergeFirstInsert || !tr.docChanged || !tr.isUserEvent('input.type')) return tr;
      mergeFirstInsert = false;
      if (tr.annotation(Transaction.userEvent) === 'input.type.compose') return tr;
      return {changes:tr.changes, selection:tr.selection, effects:tr.effects, scrollIntoView:tr.scrollIntoView,
        annotations:[Transaction.userEvent.of('input.type.compose'), ...tr.annotations.filter(a => a.type !== Transaction.userEvent)]};
    }), drawSelection(), highlightActiveLine(), markdown({codeLanguages:codeLanguage}), tasks, features, noteComments, syntaxHighlighting(defaultHighlightStyle), syntaxHighlighting(classHighlighter), EditorView.lineWrapping,
    keymap.of([...defaultKeymap,...historyKeymap]),
    EditorView.updateListener.of(update => { if(languageMenuOpen() && (update.docChanged || update.selectionSet))closeLanguageMenu(); if (!update.docChanged || !state) return; current().content = update.state.doc.toString(); current().updated = new Date().toISOString(); refreshInsights(); updateBlockMenu(); if(getCM(update.view)?.state?.vim?.insertMode) openMenuAfterInput(update); persist(); })
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
  getCM(editor).on('vim-mode-change', event => {
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
  refreshNav(); refreshInsights(); editor.focus();
}
function select(id) { if (!state || state.selected === id) return; changeEditor(id); persist(); }
function createNote() { if (!state) return; const n = newNote(); state.notes.unshift(n); changeEditor(n.id); persist(); }
function deleteNote() {
  if (!state || !confirm(t('删除这条笔记？此操作无法撤销。'))) return;
  const deleted = state.selected; const index = state.notes.findIndex(n => n.id === deleted);
  state.notes.splice(index,1); if (!state.notes.length) state.notes.push(newNote());
  changeEditor(state.notes[Math.min(index,state.notes.length-1)].id); editorStates.delete(deleted); persist();
}
function navigate(direction) { if (!state) return; const index = state.notes.findIndex(n => n.id === state.selected); const next = index + direction; if (next >= 0 && next < state.notes.length) select(state.notes[next].id); }
function hide() { if (window.webkit?.messageHandlers?.quicknote) window.webkit.messageHandlers.quicknote.postMessage({type:'hide'}); else window.quicknoteHideRequested = (window.quicknoteHideRequested || 0) + 1; }
$('new').onclick = createNote; $('delete').onclick = deleteNote; $('previous').onclick = () => navigate(1); $('next').onclick = () => navigate(-1);
function refreshInsights() {
  if (!editor) return;
  const info=analyzeCurrent(editor.state.doc.toString());
  $('insights').textContent=info.summary; $('insights').hidden=!info.summary;
}
setRateListener(()=>{ if(editor) {editor.dispatch({effects:rateEffect.of(null)}); refreshInsights();} });
function scheduleTimer() {
  const t=state?.timer; const d=timerDisplay(t);
  const deadline=t && d && !t.paused && !t.done && d.length ? Date.now()+Math.max(0,d.length-d.elapsed)*1000 : 0;
  window.webkit?.messageHandlers?.quicknote?.postMessage({type:'timer',deadline});
}
function applyTimer(command) { state.timer=timerCommand(state.timer,command); persist(); scheduleTimer(); renderTimer(); }
function renderTimer(forceAdvance=false) {
  if (!state) return;
  let timer=state.timer; const before=timer;
  if (timer && (forceAdvance || !window.webkit?.messageHandlers?.quicknote)) timer=advanceTimer(timer);
  if(timer!==before) { state.timer=timer; persist(); scheduleTimer(); }
  $('timer').hidden=!timer;
  if(!timer)return;
  $('timer-label').textContent=(timer.title ? timer.title+' · ' : '')+(timer.rest ? t(timer.phase==='work'?'专注':'休息') : t(timer.duration?'倒计时':'计时'));
  $('timer-value').textContent=timerDisplay(timer).text+(timer.done?' '+t('完成'):'');
  $('timer-pause').textContent=t(timer.paused?'继续':'暂停'); $('timer-pause').disabled=!!timer.done;
}
window.timerFinished=()=>renderTimer(true);
setInterval(renderTimer,1000);
$('timer-pause').onclick=()=>applyTimer({command:'p'});
$('timer-reset').onclick=()=>applyTimer({command:'r'});
$('timer-stop').onclick=()=>applyTimer({command:'s'});
document.addEventListener('keydown', event => {
  if (!state || event.isComposing || event.keyCode === 229) return;
  keyStartDoc = editor?.state.doc;
  if(event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase()==='l' && editor?.hasFocus) {
    if(!event.repeat && openCurrentLanguageMenu(editor)) {event.preventDefault();event.stopPropagation();}
    return;
  }
  if(event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase()==='k' && editor?.hasFocus) {
    if(!event.repeat && openCurrentBlockMenu(editor)) {closeLanguageMenu();event.preventDefault(); event.stopPropagation();}
    return;
  }
  if(event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase()==='d') {
    event.preventDefault(); event.stopPropagation();
    if(!event.repeat) deleteCurrentBlock(editor);
    return;
  }
  if(languageMenuOpen() && handleLanguageMenuKey(event)) {event.preventDefault();event.stopPropagation();return;}
  if(blockMenuOpen() && handleBlockMenuKey(event)) {event.preventDefault();event.stopPropagation();return;}
  if(!languageMenuOpen() && !blockMenuOpen() && editor?.hasFocus && !event.metaKey && !event.ctrlKey && !event.altKey && getCM(editor)?.state?.vim?.insertMode) {
    const key=event.key==='Tab' && event.shiftKey ? 'Shift-Tab' : event.key;
    const planned=planCodeEdit(editor.state,key,{indentation:codeIndentation});
    if(planned) {event.preventDefault();event.stopPropagation();editor.dispatch(planned);return;}
  }
  if(!blockMenuOpen() && getCM(editor)?.state?.vim?.insertMode && trySlash(event,editor)) {event.preventDefault();event.stopPropagation();return;}
  if (event.key.toLowerCase() === 'x' && !event.metaKey && !event.ctrlKey && !event.altKey && getCM(editor)?.state?.vim?.insertMode && scopeAt(editor.state.doc.toString(),editor.state.doc.lineAt(editor.state.selection.main.head).number)?.mode==='list') {
    const sel=editor.state.selection.main, line=editor.state.doc.lineAt(sel.head);
    if (sel.empty && sel.head===line.to && line.text.endsWith('/') && line.number>1 && !/^\s*(?:\/\/|#)/.test(line.text)) {
      const match=/^(\s*(?:(?:[-+*]|\d+[.)])\s+)?)\[([ xX])\](?=\s|$)/.exec(line.text);
      const changes=[{from:line.to-1,to:line.to}];
      if(match) changes.push({from:line.from+match[1].length+1,to:line.from+match[1].length+2,insert:/[xX]/.test(match[2])?' ':'x'});
      else changes.push({from:line.from+/^\s*/.exec(line.text)[0].length,insert:'[x] '});
      event.preventDefault(); event.stopPropagation(); editor.dispatch({changes,userEvent:'input.task.toggle'}); return;
    }
  }
  if (event.key === 'Enter' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && getCM(editor)?.state?.vim?.insertMode) {
    const selection=editor.state.selection.main;
    const line=editor.state.doc.lineAt(selection.head), scope=scopeAt(editor.state.doc.toString(),line.number);
    if(selection.empty && scope?.kind==='block' && scope.mode!=='code' && line.number===scope.end-1 && !line.text.trim() && scope.end<=editor.state.doc.lines) {
      const end=editor.state.doc.line(scope.end);
      event.preventDefault();event.stopPropagation();
      if(end.to===editor.state.doc.length) editor.dispatch({changes:{from:end.to,insert:'\n'},selection:{anchor:end.to+1},userEvent:'input.block.exit'});
      else editor.dispatch({selection:{anchor:end.to+1},scrollIntoView:true});
      return;
    }
    if (selection.empty) { const line=editor.state.doc.lineAt(selection.head); if(selection.head===line.to && scopeAt(editor.state.doc.toString(),line.number)?.mode === 'timer') { const command=parseTimer(line.text); if(command) applyTimer(command); } }
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
      if (key === 'n') createNote(); else if (key === 'd') deleteNote(); else if (key === '[') navigate(1); else if (key === ']') navigate(-1); else select(state.notes[0].id);
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
Vim.defineEx('write', 'w', () => { if (state) persist(); });
window.focusEditor = () => { if (editor) editor.focus(); };
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
window.loadNotesBase64 = value => {
  try {
    const loaded = value ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)))) : null;
    if (loaded && (!Array.isArray(loaded.notes) || !loaded.notes.length || !loaded.notes.every(n => typeof n.id === 'string' && typeof n.content === 'string' && typeof n.updated === 'string') || !loaded.notes.some(n => n.id === loaded.selected))) throw new Error(t('笔记文件格式无效'));
    if (loaded) state = loaded; else { const n = newNote(); state = {notes:[n],selected:n.id}; }
    changeEditor(state.selected); renderTimer(true); scheduleTimer(); $('save').textContent = loaded ? t('已载入') : t('新笔记');
  } catch (error) { $('save').className='error'; $('save').textContent = t('读取失败：')+error.message; }
};
window.setLanguage(lang());
if (!window.webkit?.messageHandlers?.quicknote) { const saved = localStorage.getItem('quicknote-test'); window.loadNotesBase64(saved ? btoa(unescape(encodeURIComponent(saved))) : null); }
