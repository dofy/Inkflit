// Feature blocks are written as ":::inkflit <type>" … ":::end".
export const markerPrefix = ':::inkflit';
import { t } from './i18n.js';
import { create, all } from 'mathjs';

const math = create(all);
const allowedFunctions = new Set(['sqrt','abs','round','floor','ceil','sin','cos','tan','log','log10','exp','min','max']);
const allowedOperators = new Set(['add','subtract','multiply','divide','pow','unaryMinus','unaryPlus','to','percentage']);
export const modeOf = text => /^(list|math|sum|avg|count)(?:\s*:\s*.*)?\s*$/i.exec(text.split('\n')[0].trim())?.[1].toLowerCase() || '';
// Feature fences and ordinary Markdown code fences create independent scopes.
export const blockTypes = ['list','math','sum','avg','count','code'];
export function featureScopes(text) {
  const lines=text.split('\n'), scopes=[], globalMode=modeOf(text);
  if(globalMode) scopes.push({mode:globalMode,start:1,end:lines.length,global:true});
  let active=null;
  for(let i=0;i<lines.length;i++) {
    const line=lines[i];
    if(active) {
      const close=active.kind==='block' ? /^:::end\s*$/.test(line) : new RegExp('^\\s*'+active.marker[0]+'{'+active.marker.length+',}\\s*$').test(line);
      if(close) { scopes.push({...active,start:active.line,end:i+1,global:false,closed:true}); active=null; }
      continue;
    }
    const block=/^:::inkflit (list|math|sum|avg|count|code)(?: ([\w+.-]+))?\s*$/.exec(line);
    if(block) { active={kind:'block',mode:block[1],language:block[2]||'',line:i+1}; continue; }
    const open=/^\s*(`{3,}|~{3,})([^`]*)$/.exec(line);
    if(open) {
      const info=open[2].trim().toLowerCase(), keyword=/^(list|math|sum|avg|count)$/.exec(info);
      active={kind:'fence',marker:open[1],mode:keyword ? keyword[1] : 'code',line:i+1};
    }
  }
  if(active) scopes.push({...active,start:active.line,end:lines.length+1,global:false,closed:false});
  return scopes;
}
let scopeCacheText=null, scopeCache=[];
export function scopeAt(text, line) {
  if(text!==scopeCacheText) {
    scopeCacheText=text;
    const lines=text.split('\n'), scopes=featureScopes(text), global=scopes.find(s=>s.global);
    scopeCache=new Array(lines.length+1).fill(null);
    if(global) for(let n=2;n<=lines.length;n++) scopeCache[n]=global;
    for(const scope of scopes.filter(s=>!s.global)) {
      for(let n=scope.start;n<=scope.end && n<=lines.length;n++) scopeCache[n]=n>scope.start && n<scope.end ? scope : null;
    }
  }
  return scopeCache[line] || null;
}
export function evaluateExpression(expression, scope = {}, rates = null) {
  try {
    let source = expression.trim().replace(/[×]/g,'*').replace(/[÷]/g,'/').replace(/\bof\b/gi,'*');
    if (!source || source.length > 256) return null;
    const currency = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([A-Za-z]{3})\s+(?:to|in)\s+([A-Za-z]{3})$/i.exec(source);
    if (currency && currency[2] === currency[2].toUpperCase() && currency[3] === currency[3].toUpperCase()) {
      if (!rates) return {text:t('block.exchangeRatesUnavailable')};
      const from = currency[2].toUpperCase(), to = currency[3].toUpperCase();
      if (rates.values[from] && rates.values[to]) return {value:Number(currency[1]) * rates.values[to] / rates.values[from], text:`${formatNumber(Number(currency[1]) * rates.values[to] / rates.values[from])} ${to}`, rateDate:rates.date};
      return {text:t('block.unsupportedCurrency')};
    }
    const node = math.parse(source);
    let nodes = 0, valid = true;
    node.traverse(n => {
      if (++nodes > 100) valid = false;
      if (!['ConstantNode','SymbolNode','OperatorNode','ParenthesisNode','FunctionNode'].includes(n.type)) valid = false;
      if (n.type === 'ConstantNode' && (typeof n.value !== 'number' || !Number.isFinite(n.value) || Math.abs(n.value) > 1e100)) valid = false;
      if (n.type === 'OperatorNode' && (!allowedOperators.has(n.fn) || n.fn === 'pow' && n.args[1]?.type !== 'ConstantNode')) valid = false;
      if (n.type === 'OperatorNode' && n.fn === 'pow' && Math.abs(n.args[1]?.value) > 100) valid = false;
      if (n.type === 'FunctionNode' && (n.fn.type !== 'SymbolNode' || !allowedFunctions.has(n.fn.name))) valid = false;
    });
    if (!valid) return null;
    const value = node.evaluate(new Map(Object.entries(scope)));
    if (typeof value === 'number' && Number.isFinite(value)) return {value, text:formatNumber(value)};
    if (math.isUnit(value) && Number.isFinite(value.value)) return {value, text:math.format(value, {precision:10})};
  } catch (_) { /* Incomplete or unsupported expressions remain editable. */ }
  return null;
}
export function formatNumber(n) { return Number(n.toPrecision(10)).toLocaleString('en-US', {maximumFractionDigits:10}); }
// Highlight names in definitions and in later expressions within this block.
export function mathVariableRanges(lines) {
  const defined=new Set(), ranges=[];
  let inFence=false;
  for(let index=0;index<lines.length;index++) {
    const line=lines[index], trimmed=line.trim();
    if (/^(```|~~~)/.test(trimmed)) { inFence=!inFence; continue; }
    if(!trimmed || trimmed.startsWith('//') || inFence) continue;
    const definition=/^(\s*)([\p{L}_][\p{L}\p{N}_]*)\s*:\s*(.+)$/u.exec(line);
    let start=0, end=line.length;
    if(definition) {
      const from=definition[1].length;
      ranges.push({line:index,from,to:from+definition[2].length});
      start=line.indexOf(':',from+definition[2].length)+1;
    } else if(trimmed.endsWith('=')) {
      end=line.lastIndexOf('=');
    } else continue;
    const expression=line.slice(start,end);
    for(const match of expression.matchAll(/[\p{L}_][\p{L}\p{N}_]*/gu)) {
      const from=start+match.index;
      if(from>0 && /[\p{L}\p{N}_]/u.test(line[from-1])) continue;
      if(defined.has(match[0])) ranges.push({line:index,from,to:from+match[0].length});
    }
    if(definition) defined.add(definition[2]);
  }
  return ranges;
}
export function analyze(text, rates = null) {
  const mode = modeOf(text), lines = text.split('\n'), results = [], values = [], scope = {};
  let inFence = false;
  for (let i=1; i<lines.length; i++) {
    const line=lines[i].trim();
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (!line || /^\/\//.test(line) || inFence) continue;
    if (mode === 'math') {
      const assignment = /^([\p{L}_][\p{L}\p{N}_]*)\s*:\s*(.+)$/u.exec(line);
      if (assignment) { const r=evaluateExpression(assignment[2],scope,rates); if(r) scope[assignment[1]]=r.value; continue; }
      if (line.endsWith('=')) {
        const r=evaluateExpression(line.slice(0,-1),scope,rates);
        if (r) { results.push({line:i+1,...r}); if(r.value !== undefined) scope.ans=r.value; }
      }
    } else if (mode === 'sum' || mode === 'avg') {
      for (const match of line.matchAll(/(?<![\p{L}\p{N}_])[-+]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?![\p{L}\p{N}_])/gu)) values.push(Number(match[0].replaceAll(',','')));
    }
  }
  if (mode === 'count') {
    const content=lines.slice(1).filter(x=>x.trim() && !/^\s*\/\//.test(x));
    const joined=content.join('\n');
    const words=typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined,{granularity:'word'}).segment(joined)].filter(x=>x.isWordLike).length : (joined.match(/[\p{L}\p{N}]+/gu)||[]).length;
    const chars=typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(joined)].length : Array.from(joined).length;
    return {mode, results, summary:t('block.countSummary').replace('{items}',content.length).replace('{words}',words).replace('{chars}',chars)};
  }
  const total=values.reduce((a,b)=>a+b,0);
  const summary=mode==='sum' ? t('block.sumSummary') : mode==='avg' ? t('block.averageSummary') : '';
  return {mode,results,summary:summary.replace('{total}',mode==='avg' ? (values.length ? formatNumber(total/values.length) : '—') : formatNumber(total)).replace('{count}',values.length)};
}
export function analyzeScopes(text,rates=null) {
  const lines=text.split('\n');
  return featureScopes(text).map(scope=>{
    if(scope.global) return {...scope,...analyze(text,rates)};
    if(scope.mode==='code') return {...scope,results:[],summary:''};
    const body=lines.slice(scope.start,Math.min(scope.end-1,lines.length));
    const info=analyze([scope.mode,...body].join('\n'),rates);
    return {...scope,...info,results:info.results.map(r=>({...r,line:scope.start+r.line-1}))};
  });
}
