import { create, all } from 'mathjs';

const math = create(all);
const allowedFunctions = new Set(['sqrt','abs','round','floor','ceil','sin','cos','tan','log','log10','exp','min','max']);
const allowedOperators = new Set(['add','subtract','multiply','divide','pow','unaryMinus','unaryPlus','to','percentage']);
export const modeOf = text => /^(list|math|sum|avg|count)(?:\s*:\s*.*)?\s*$/i.exec(text.split('\n')[0].trim())?.[1].toLowerCase() || '';
// Feature fences and ordinary Markdown code fences create independent scopes.
export const blockTypes = ['list','math','sum','avg','count','code','timer'];
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
    const block=/^:::quicknote (list|math|sum|avg|count|code|timer)(?: ([\w+.-]+))?\s*$/.exec(line);
    if(block) { active={kind:'block',mode:block[1],language:block[2]||'',line:i+1}; continue; }
    const open=/^\s*(`{3,}|~{3,})([^`]*)$/.exec(line);
    if(open) {
      const info=open[2].trim().toLowerCase(), keyword=/^(list|math|sum|avg|count|timer)$/.exec(info);
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
      if (!rates) return {text:'汇率加载中或不可用'};
      const from = currency[2].toUpperCase(), to = currency[3].toUpperCase();
      if (rates.values[from] && rates.values[to]) return {value:Number(currency[1]) * rates.values[to] / rates.values[from], text:`${formatNumber(Number(currency[1]) * rates.values[to] / rates.values[from])} ${to}`, rateDate:rates.date};
      return {text:'不支持的币种'};
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
export function analyze(text, rates = null) {
  const mode = modeOf(text), lines = text.split('\n'), results = [], values = [], scope = {};
  let inFence = false;
  for (let i=1; i<lines.length; i++) {
    const line=lines[i].trim();
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (!line || /^\/\//.test(line) || inFence) continue;
    if (mode === 'math' || mode === 'sum' || mode === 'avg') {
      const assignment = mode === 'math' && /^([\p{L}_][\p{L}\p{N}_]*)\s*:\s*(.+)$/u.exec(line);
      if (assignment) { const r=evaluateExpression(assignment[2],scope,rates); if(r) scope[assignment[1]]=r.value; continue; }
      if (line.endsWith('=')) {
        const r=evaluateExpression(line.slice(0,-1),scope,rates);
        if (r) { results.push({line:i+1,...r}); if(r.value !== undefined) scope.ans=r.value; if(typeof r.value==='number') values.push(r.value); }
      } else if (mode !== 'math') {
        for (const match of line.matchAll(/(?<![\p{L}\p{N}_])[-+]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?![\p{L}\p{N}_])/gu)) values.push(Number(match[0].replaceAll(',','')));
      }
    }
  }
  if (mode === 'count') {
    const content=lines.slice(1).filter(x=>x.trim() && !/^\s*\/\//.test(x));
    const joined=content.join('\n');
    const words=typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined,{granularity:'word'}).segment(joined)].filter(x=>x.isWordLike).length : (joined.match(/[\p{L}\p{N}]+/gu)||[]).length;
    const chars=typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(joined)].length : Array.from(joined).length;
    return {mode, results, summary:`${content.length} 项 · ${words} 词 · ${chars} 字符`};
  }
  const total=values.reduce((a,b)=>a+b,0);
  return {mode,results,summary: mode==='sum' ? `合计 ${formatNumber(total)} · ${values.length} 个数` : mode==='avg' ? `平均 ${values.length ? formatNumber(total/values.length) : '—'} · ${values.length} 个数` : ''};
}
export function parseTimer(line, now = new Date()) {
  const match=/^\s*timer(?:\s+([^:]*?(?::\d{1,2})?(?:\s+\d+(?:\.\d+)?)?))?(?:\s*:\s*(.*))?\s*$/i.exec(line);
  if (!match) return null;
  const arg=(match[1]||'').trim().toLowerCase(), title=match[2]||'';
  if (['p','r','s','0'].includes(arg)) return {command:arg};
  if (!arg) return {command:'start',duration:0,title};
  if (arg==='pomo') return {command:'start',duration:25*60,rest:5*60,title};
  const clock=/^(\d{1,2}):(\d{2})$/.exec(arg);
  if (clock) { const h=Number(clock[1]),m=Number(clock[2]); if(m>=60)return null; if(h>=12 && h<24) { const target=new Date(now); target.setHours(h,m,0,0); if(target<=now)target.setDate(target.getDate()+1); return {command:'start',duration:(target-now)/1000,title}; } const seconds=h*60+m; return seconds>0 ? {command:'start',duration:seconds,title} : null; }
  const duration=/^(\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?$/.exec(arg);
  if(duration && Number(duration[1])>0 && Number(duration[1])<=10080 && (!duration[2] || Number(duration[2])<=10080)) return {command:'start',duration:Number(duration[1])*60,rest:Number(duration[2]||0)*60,title};
  const time=/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(arg);
  if(time) { let h=Number(time[1]),m=Number(time[2]||0); if(h<1||h>12||m>59)return null; h=h%12+(time[3]==='pm'?12:0); const target=new Date(now); target.setHours(h,m,0,0); if(target<=now)target.setDate(target.getDate()+1); return {command:'start',duration:(target-now)/1000,title}; }
  return null;
}

export function analyzeScopes(text,rates=null) {
  const lines=text.split('\n');
  return featureScopes(text).map(scope=>{
    if(scope.global) return {...scope,...analyze(text,rates)};
    if(scope.mode==='code' || scope.mode==='timer') return {...scope,results:[],summary:''};
    const body=lines.slice(scope.start,Math.min(scope.end-1,lines.length));
    const info=analyze([scope.mode,...body].join('\n'),rates);
    return {...scope,...info,results:info.results.map(r=>({...r,line:scope.start+r.line-1}))};
  });
}
