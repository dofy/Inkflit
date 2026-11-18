import { t, lang } from './i18n.js';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { analyzeScopes, scopeAt, scopesOf, mathHighlights, nestedLines, headerRanges, calculationModes } from './features.js';
import { codeLanguage } from './code-languages.js';
import { highlightTree, classHighlighter } from '@lezer/highlight';
import { openBlockMenu } from './block-menu.js';
import { openLanguageMenu } from './language-menu.js';
import { currentRates, currencyCodes, refreshRates } from './rates.js';
export { setRateListener } from './rates.js';
class Result extends WidgetType {
  constructor(text) { super(); this.text=text; }
  eq(other) { return this.text===other.text; }
  toDOM() { const el=document.createElement('span'); el.className='calculation-result'; el.textContent=' '+this.text; return el; }
}
class ListBox extends WidgetType {
  constructor(pos) { super(); this.pos=pos; }
  eq(other) { return this.pos===other.pos; }
  toDOM(view) {
    const b=document.createElement('button'); b.type='button'; b.tabIndex=-1; b.className='task-checkbox list-checkbox'; b.setAttribute('role','checkbox'); b.setAttribute('aria-checked','false'); b.setAttribute('aria-label',t('editor.markComplete'));
    b.addEventListener('mousedown', e=>{e.preventDefault();e.stopPropagation();});
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();view.dispatch({changes:{from:this.pos,insert:'[x] '},userEvent:'input.task.toggle'});view.focus();});
    return b;
  }
  ignoreEvent() { return false; }
}
const pendingLanguages=new Set();
const blockNames={list:'block.checklist',math:'block.math',sum:'block.sum',avg:'block.average',count:'block.count',code:'block.code'};
class BlockHeader extends WidgetType {
  constructor(scope) {super();this.scope=scope;this.language=lang();}
  eq(other){return this.language===other.language && this.scope.start===other.scope.start && this.scope.mode===other.scope.mode && this.scope.language===other.scope.language && this.scope.end===other.scope.end;}
  toDOM(view) {
    const wrap=document.createElement('span');wrap.className='block-header';
    const button=document.createElement('button');button.type='button';button.className='block-type';button.textContent=t(blockNames[this.scope.mode])+' ▾';button.setAttribute('aria-label',t('block.menuLabel')+': '+t(blockNames[this.scope.mode]));
    button.addEventListener('mousedown',e=>e.preventDefault());button.addEventListener('click',e=>{e.preventDefault();openBlockMenu({from:view.state.doc.line(this.scope.start).from,scope:this.scope});});wrap.append(button);
    if(this.scope.mode==='code') {
      const language=document.createElement('button');language.type='button';language.className='block-language';language.tabIndex=-1;
      const names={'':'editor.plainText',javascript:'JavaScript',typescript:'TypeScript',python:'Python',swift:'Swift',json:'JSON',html:'HTML',css:'CSS',sql:'SQL',shell:'Shell',markdown:'Markdown'};
      language.textContent=t(names[this.scope.language||''] || this.scope.language);language.setAttribute('aria-label',t('editor.codeLanguage'));language.setAttribute('aria-haspopup','listbox');language.setAttribute('aria-expanded','false');language.setAttribute('aria-controls','language-menu');language.title=t('editor.chooseCodeLanguage');
      language.addEventListener('mousedown',event=>event.preventDefault());language.addEventListener('click',event=>{event.preventDefault();openLanguageMenu(view,this.scope,language);});wrap.append(language);
    }
    return wrap;
  }
  ignoreEvent(event){return !!event.target?.closest?.('.block-language');}
}
class BlockEnd extends WidgetType { toDOM(){const el=document.createElement('span');el.className='block-end';el.textContent='';return el;} }
const codeLine=Decoration.line({class:'cm-code-line'}), calcLine=Decoration.line({class:'cm-calc-line'});
function decorateCode(view,scope,decorations) {
  if(!scope.language || scope.start>=view.state.doc.lines)return;
  const description=codeLanguage(scope.language); if(!description)return;
  if(!description.support) {
    if(!pendingLanguages.has(description)) {pendingLanguages.add(description);description.load().then(()=>view.dispatch({effects:rateEffect.of(null)})).catch(()=>{}).finally(()=>pendingLanguages.delete(description));}
    return;
  }
  const doc=view.state.doc, from=doc.line(scope.start+1).from, to=doc.line(Math.min(doc.lines,scope.last)).to;
  if(to<=from)return;
  try { highlightTree(description.support.language.parser.parse(doc.sliceString(from,to)),classHighlighter,(a,b,classes)=>{if(classes && b>a) decorations.push(Decoration.mark({class:classes}).range(from+a,from+b));}); } catch (_) {}
}
// One analysis per document, rates and language (summaries are translated),
// shared by the decorations and the footer summary.
let analysis={doc:null,rates:null,language:null,scopes:null};
function analysisOf(doc) {
  const rates=currentRates(), language=lang();
  if(analysis.doc!==doc || analysis.rates!==rates || analysis.language!==language) analysis={doc,rates,language,scopes:analyzeScopes(doc.toString(),rates,scopesOf(doc))};
  return analysis.scopes;
}
function decorate(view) {
  const doc=view.state.doc, text=doc.toString(), scopes=analysisOf(doc), decorations=[], currencies=new Set(currencyCodes());
  if (scopes.some(s=>s.mode==='math')) refreshRates();
  // A first line that sets the note's mode shows its keyword (and language) as a tag.
  for (const range of headerRanges(text)) decorations.push(Decoration.mark({class:range.kind==='keyword' ? 'cm-note-mode' : 'cm-note-mode-language'}).range(range.from,range.to));
  for (const scope of scopes) {
    if(scope.kind==='block') {
      const first=doc.line(scope.start);
      decorations.push(Decoration.line({class:'cm-block-header-line'}).range(first.from));
      decorations.push(Decoration.replace({widget:new BlockHeader(scope)}).range(first.from,first.to));
      if(scope.end<=doc.lines) {const last=doc.line(scope.end);decorations.push(Decoration.line({class:'cm-block-end-line'}).range(last.from));decorations.push(Decoration.replace({widget:new BlockEnd()}).range(last.from,last.to));}
      if(scope.mode==='code') decorateCode(view,scope,decorations);
    }
    if(scope.global && scope.mode==='code') decorateCode(view,scope,decorations);
    // Calculation lines: "12." is a number, not a list marker.
    if(calculationModes.has(scope.mode)) {
      const last=Math.min(doc.lines,scope.last);
      // Lines of blocks nested in a whole-note mode belong to those blocks.
      for(let n=scope.start+1;n<=last;n++) { const at=scopeAt(doc,n); if(at && at.start===scope.start && at.end===scope.end) decorations.push(calcLine.range(doc.line(n).from)); }
    }
    // Code lines keep Markdown's own styling ("# x" as a heading) out of the code.
    if(scope.mode==='code') {
      const last=Math.min(doc.lines,scope.last);
      for(let n=scope.start+1;n<=last;n++) decorations.push(codeLine.range(doc.line(n).from));
    }
    if(scope.mode==='math') {
      const first=scope.start+1, last=Math.min(doc.lines,scope.last), lines=[], nested=scope.global ? nestedLines(scopes) : new Set();
      for(let n=first;n<=last;n++) lines.push(nested.has(n) ? '' : doc.line(n).text);
      for(const range of mathHighlights(lines,currencies)) {
        const line=doc.line(first+range.line);
        decorations.push(Decoration.mark({class:'cm-math-'+range.kind}).range(line.from+range.from,line.from+range.to));
      }
    }
    for (const result of scope.results) { const line=doc.line(result.line); decorations.push(Decoration.widget({widget:new Result(result.text + (result.rateDate ? ` · ${result.rateDate}` : '')),side:1}).range(line.to)); }
    if (!scope.global && scope.summary && scope.end<=doc.lines) { const line=doc.line(scope.end); decorations.push(Decoration.widget({widget:new Result('  '+scope.summary),side:1}).range(line.to)); }
  }
  for(let n=2;n<=doc.lines;n++) {
    const scope=scopeAt(doc,n); if(scope?.mode!=='list') continue;
    const line=doc.line(n), trimmed=line.text.trim();
    if (!trimmed || /^(\/\/|#{1,6}(?:\s|$))/.test(trimmed) || /^(?:[-+*]\s+|\d+[.)]\s+)?\[[ xX]\](?:\s|$)/.test(trimmed)) continue;
    const indent=/^\s*/.exec(line.text)[0].length;
    decorations.push(Decoration.widget({widget:new ListBox(line.from+indent),side:-1}).range(line.from+indent));
  }
  return Decoration.set(decorations,true);
}
export const features = ViewPlugin.fromClass(class {
  constructor(view){this.decorations=decorate(view);}
  // Decorations cover the whole document, so scrolling or resizing changes nothing.
  update(u){if(u.docChanged || u.transactions.some(t=>t.effects.some(e=>e.is(rateEffect)))) this.decorations=decorate(u.view);}
},{decorations:v=>v.decorations});
import { StateEffect } from '@codemirror/state';
export const rateEffect=StateEffect.define();
export const analyzeCurrent = doc => analysisOf(doc).find(scope=>scope.global) || {summary:''};
