import { t, lang } from './i18n.js';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { analyzeScopes, scopeAt } from './features.js';
import { codeLanguage } from './code-languages.js';
import { highlightTree, classHighlighter } from '@lezer/highlight';
import { openBlockMenu } from './block-menu.js';
import { openLanguageMenu } from './language-menu.js';
let rates = null, onRates = () => {}, requestedAt = 0;
export function setRateListener(fn) { onRates = fn; }
export async function refreshRates() {
  if (Date.now()-requestedAt < 3600000) return;
  requestedAt=Date.now();
  try {
    const response=await fetch('https://api.frankfurter.dev/v1/latest', {referrerPolicy:'no-referrer'});
    if (!response.ok) throw new Error('exchange rates unavailable');
    const data=await response.json();
    if (!data.date || !data.rates || typeof data.rates.USD !== 'number') throw new Error('invalid rates');
    rates={date:data.date,values:{EUR:1,...data.rates}}; onRates();
  } catch (_) { requestedAt=Date.now()-3500000; onRates(); }
}
class Result extends WidgetType {
  constructor(text) { super(); this.text=text; }
  eq(other) { return this.text===other.text; }
  toDOM() { const el=document.createElement('span'); el.className='calculation-result'; el.textContent=' '+this.text; return el; }
}
class ListBox extends WidgetType {
  constructor(pos) { super(); this.pos=pos; }
  eq(other) { return this.pos===other.pos; }
  toDOM(view) {
    const b=document.createElement('button'); b.type='button'; b.tabIndex=-1; b.className='task-checkbox list-checkbox'; b.setAttribute('role','checkbox'); b.setAttribute('aria-checked','false'); b.setAttribute('aria-label',t('标记为已完成'));
    b.addEventListener('mousedown', e=>{e.preventDefault();e.stopPropagation();});
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();view.dispatch({changes:{from:this.pos,insert:'[x] '},userEvent:'input.task.toggle'});view.focus();});
    return b;
  }
  ignoreEvent() { return false; }
}
const pendingLanguages=new Set();
const blockNames={list:'清单',math:'计算',sum:'求和',avg:'平均值',count:'计数',code:'代码'};
class BlockHeader extends WidgetType {
  constructor(scope) {super();this.scope=scope;this.language=lang();}
  eq(other){return this.language===other.language && this.scope.start===other.scope.start && this.scope.mode===other.scope.mode && this.scope.language===other.scope.language && this.scope.end===other.scope.end;}
  toDOM(view) {
    const wrap=document.createElement('span');wrap.className='block-header';
    const button=document.createElement('button');button.type='button';button.className='block-type';button.textContent=t(blockNames[this.scope.mode])+' ▾';button.setAttribute('aria-label',t('功能块')+': '+t(blockNames[this.scope.mode]));
    button.addEventListener('mousedown',e=>e.preventDefault());button.addEventListener('click',e=>{e.preventDefault();openBlockMenu({from:view.state.doc.line(this.scope.start).from,scope:this.scope});});wrap.append(button);
    if(this.scope.mode==='code') {
      const language=document.createElement('button');language.type='button';language.className='block-language';language.tabIndex=-1;
      const names={'':'纯文本',javascript:'JavaScript',typescript:'TypeScript',python:'Python',swift:'Swift',json:'JSON',html:'HTML',css:'CSS',sql:'SQL',shell:'Shell',markdown:'Markdown'};
      language.textContent=t(names[this.scope.language||''] || this.scope.language);language.setAttribute('aria-label',t('代码语言'));language.setAttribute('aria-haspopup','listbox');language.setAttribute('aria-expanded','false');language.setAttribute('aria-controls','language-menu');language.title=t('选择代码语言 ⌘L');
      language.addEventListener('mousedown',event=>event.preventDefault());language.addEventListener('click',event=>{event.preventDefault();openLanguageMenu(view,this.scope,language);});wrap.append(language);
    }
    return wrap;
  }
  ignoreEvent(event){return !!event.target?.closest?.('.block-language');}
}
class BlockEnd extends WidgetType { toDOM(){const el=document.createElement('span');el.className='block-end';el.textContent='';return el;} }
function decorateCode(view,scope,decorations) {
  if(!scope.language || scope.start>=view.state.doc.lines)return;
  const description=codeLanguage(scope.language); if(!description)return;
  if(!description.support) {
    if(!pendingLanguages.has(description)) {pendingLanguages.add(description);description.load().then(()=>view.dispatch({effects:rateEffect.of(null)})).catch(()=>{}).finally(()=>pendingLanguages.delete(description));}
    return;
  }
  const doc=view.state.doc, from=doc.line(scope.start+1).from, to=scope.end<=doc.lines?doc.line(scope.end).from-1:doc.length;
  if(to<=from)return;
  try { highlightTree(description.support.language.parser.parse(doc.sliceString(from,to)),classHighlighter,(a,b,classes)=>{if(classes && b>a) decorations.push(Decoration.mark({class:classes}).range(from+a,from+b));}); } catch (_) {}
}
function decorate(view) {
  const doc=view.state.doc, text=doc.toString(), scopes=analyzeScopes(text,rates), decorations=[];
  if (scopes.some(s=>s.mode==='math')) refreshRates();
  for (const scope of scopes) {
    if(scope.kind==='block') {
      const first=doc.line(scope.start);
      decorations.push(Decoration.line({class:'cm-block-header-line'}).range(first.from));
      decorations.push(Decoration.replace({widget:new BlockHeader(scope)}).range(first.from,first.to));
      if(scope.end<=doc.lines) {const last=doc.line(scope.end);decorations.push(Decoration.line({class:'cm-block-end-line'}).range(last.from));decorations.push(Decoration.replace({widget:new BlockEnd()}).range(last.from,last.to));}
      if(scope.mode==='code') decorateCode(view,scope,decorations);
    }
    for (const result of scope.results) { const line=doc.line(result.line); decorations.push(Decoration.widget({widget:new Result(result.text + (result.rateDate ? ` · ${result.rateDate}` : '')),side:1}).range(line.to)); }
    if (!scope.global && scope.summary && scope.end<=doc.lines) { const line=doc.line(scope.end); decorations.push(Decoration.widget({widget:new Result('  '+scope.summary),side:1}).range(line.to)); }
  }
  for(let n=2;n<=doc.lines;n++) {
    const scope=scopeAt(text,n); if(scope?.mode!=='list') continue;
    const line=doc.line(n), trimmed=line.text.trim();
    if (!trimmed || /^(\/\/|#{1,6}(?:\s|$))/.test(trimmed) || /^(?:[-+*]\s+|\d+[.)]\s+)?\[[ xX]\](?:\s|$)/.test(trimmed)) continue;
    const indent=/^\s*/.exec(line.text)[0].length;
    decorations.push(Decoration.widget({widget:new ListBox(line.from+indent),side:-1}).range(line.from+indent));
  }
  return Decoration.set(decorations,true);
}
export const features = ViewPlugin.fromClass(class {
  constructor(view){this.decorations=decorate(view);}
  update(u){if(u.docChanged || u.viewportChanged || u.geometryChanged || u.transactions.some(t=>t.effects.some(e=>e.is(rateEffect)))) this.decorations=decorate(u.view);}
},{decorations:v=>v.decorations});
import { StateEffect } from '@codemirror/state';
export const rateEffect=StateEffect.define();
export const analyzeCurrent = text => analyzeScopes(text,rates).find(scope=>scope.global) || {summary:''};
