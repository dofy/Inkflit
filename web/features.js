// Feature blocks are written as ":::inkflit <type>" … ":::end".
import { t } from './i18n.js';
import { create, all } from 'mathjs';

export const markerPrefix = ':::inkflit';
const blockTypes = ['list','math','sum','avg','count','code'];
const headerPattern = new RegExp(`^(${blockTypes.join('|')})(?:\\s+([\\w+.-]+))?(?:\\s*:\\s*.*)?\\s*$`, 'i');
const blockPattern = new RegExp(`^${markerPrefix} (${blockTypes.join('|')})(?: ([\\w+.-]+))?\\s*$`);
const blockEndPattern = /^:::end\s*$/;
const fenceModes = new Set(blockTypes.filter(type=>type!=='code'));

// An invisible feature marker still has to separate Markdown blocks.
// Otherwise a dash after :::end can turn the entire preceding paragraph into a heading.
const isBlockMarker = line => blockPattern.test(line) || blockEndPattern.test(line);
export const markdownBlockMarkers = {
  defineNodes: [{ name: 'FeatureBlockMarker', block: true }],
  parseBlock: [{
    name: 'FeatureBlockMarker',
    parse(context, line) {
      if (!isBlockMarker(line.text)) return false;
      const from = context.lineStart, to = from + line.text.length;
      context.nextLine();
      context.addElement(context.elt('FeatureBlockMarker', from, to));
      return true;
    },
    endLeaf(_context, line) { return isBlockMarker(line.text); },
  }],
};

const math = create(all);
math.createUnit({mph:'1 mi/h', nmi:'1852 m'});
// mathjs names take Latin and Greek letters only; allow any letter, so "单价: 80" works.
const isAlpha = math.parse.isAlpha;
math.parse.isAlpha = (c, cPrev, cNext) => isAlpha(c, cPrev, cNext) || /\p{L}/u.test(c);
// The bare symbol "min" resolves to the min() function before the minute unit, so bind it to the unit explicitly.
const minuteUnit = math.unit('min');
const bindMinute = (node, scope) => 'min' in scope ? node : node.transform((n, path) => n.type === 'SymbolNode' && n.name === 'min' && path !== 'fn' ? new math.ConstantNode(minuteUnit) : n);
const allowedFunctions = new Set(['sqrt','abs','round','floor','ceil','sin','cos','tan','log','log10','exp','min','max']);
const allowedOperators = new Set(['add','subtract','multiply','divide','pow','unaryMinus','unaryPlus','to','percentage']);
// A note's first line may set a mode for the whole note: a keyword, a language
// after "code" ("code js"), and a title after a colon ("math: Trip").
export function noteHeader(text) {
  const match=headerPattern.exec(text.split('\n')[0].trim());
  if(!match || (match[2] && match[1].toLowerCase()!=='code')) return {mode:'',language:''};
  return {mode:match[1].toLowerCase(),language:(match[2]||'').toLowerCase()};
}
export const modeOf = text => noteHeader(text).mode;
// Where the header's keyword and language sit on the first line, for styling;
// empty when the first line does not set a mode.
export function headerRanges(text) {
  if(!noteHeader(text).mode) return [];
  const match=/^(\s*)([A-Za-z]+)(?:(\s+)([\w+.-]+))?/.exec(text.split('\n')[0]), ranges=[];
  const start=match[1].length;
  ranges.push({from:start,to:start+match[2].length,kind:'keyword'});
  if(match[4]) { const from=start+match[2].length+match[3].length; ranges.push({from,to:from+match[4].length,kind:'language'}); }
  return ranges;
}
// Feature fences and ordinary Markdown code fences create independent scopes.
// Each scope has start (its first line: the marker, fence or note header),
// end and last, all 1-based. A block's or fence's end is its closing line
// (lines+1 while unclosed); a whole note's end is its last line. Use last,
// the last content line, rather than working it out from end.
export function featureScopes(text) {
  const lines=text.split('\n'), scopes=[], {mode:globalMode,language}=noteHeader(text);
  // A whole-note code mode is all code: markers and fences inside it are text.
  if(globalMode==='code') return [{mode:'code',language,start:1,end:lines.length,last:lines.length,global:true}];
  if(globalMode) scopes.push({mode:globalMode,start:1,end:lines.length,last:lines.length,global:true});
  let active=null;
  for(let i=0;i<lines.length;i++) {
    const line=lines[i];
    if(active) {
      const close=active.kind==='block' ? blockEndPattern.test(line) : new RegExp('^\\s*'+active.marker[0]+'{'+active.marker.length+',}\\s*$').test(line);
      if(close) { scopes.push({...active,start:active.line,end:i+1,last:i,global:false,closed:true}); active=null; }
      continue;
    }
    const block=blockPattern.exec(line);
    if(block) { active={kind:'block',mode:block[1],language:block[2]||'',line:i+1}; continue; }
    const open=/^\s*(`{3,}|~{3,})([^`]*)$/.exec(line);
    if(open) {
      const info=open[2].trim().toLowerCase(), keyword=fenceModes.has(info);
      active={kind:'fence',marker:open[1],mode:keyword ? info : 'code',line:i+1};
    }
  }
  if(active) scopes.push({...active,start:active.line,end:lines.length+1,last:lines.length,global:false,closed:false});
  return scopes;
}
// Calculation modes treat "12. 0.2" as numbers, not a Markdown list.
export const calculationModes = new Set(['math','sum','avg','count']);
// Scope of each line (1-based): the scope whose content the line is in, or
// null for markers and plain text.
function lineScopes(scopes, lineCount) {
  const map=new Array(lineCount+1).fill(null), global=scopes.find(s=>s.global);
  if(global) for(let n=2;n<=lineCount;n++) map[n]=global;
  for(const scope of scopes.filter(s=>!s.global)) {
    for(let n=scope.start;n<=scope.end && n<=lineCount;n++) map[n]=n>scope.start && n<scope.end ? scope : null;
  }
  return map;
}
// CodeMirror documents (Text) are immutable, so their scopes are cached per
// document: callers pass state.doc and no longer flatten it to a string.
const docScopes=new WeakMap();
function scopeInfo(doc) {
  let info=docScopes.get(doc);
  if(!info) { const scopes=featureScopes(doc.toString()); info={scopes,lines:lineScopes(scopes,doc.lines)}; docScopes.set(doc,info); }
  return info;
}
let textCache=null, textInfo=null;
function textScopeInfo(text) {
  if(text!==textCache) { const scopes=featureScopes(text); textCache=text; textInfo={scopes,lines:lineScopes(scopes,text.split('\n').length)}; }
  return textInfo;
}
const infoOf=source=>typeof source==='string' ? textScopeInfo(source) : scopeInfo(source);
// Every scope of a document (state.doc) or text, cached.
export const scopesOf=source=>infoOf(source).scopes;
// The scope a line's content belongs to, for a document (state.doc) or text.
export function scopeAt(source, line) {
  return infoOf(source).lines[line] || null;
}
const mathSource = input => input.trim().replaceAll('×', '*').replaceAll('÷', '/').replace(/\bof\b/gi, '*');
function currencyConversion(source) {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([A-Za-z]{3})\s+(?:to|in)\s+([A-Za-z]{3})$/i.exec(source);
  return match && match[2] === match[2].toUpperCase() && match[3] === match[3].toUpperCase() ? match.slice(1) : null;
}
function parseMathExpression(source) {
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
  return valid ? node : null;
}

// Formatting checks the parsed expression without calculating it or fetching rates.
export function sameMathExpression(before, after) {
  const left = mathSource(before), right = mathSource(after);
  if (!left || !right || left.length > 256 || right.length > 256) return false;
  const leftCurrency = currencyConversion(left), rightCurrency = currencyConversion(right);
  if (leftCurrency || rightCurrency) return !!leftCurrency && leftCurrency.every((value, i) => value === rightCurrency?.[i]);
  try {
    const original = parseMathExpression(left), formatted = parseMathExpression(right);
    return !!original && !!formatted && JSON.stringify(original) === JSON.stringify(formatted);
  } catch (_) { return false; }
}

export function evaluateExpression(expression, scope = {}, rates = null) {
  try {
    const source = mathSource(expression);
    if (!source || source.length > 256) return null;
    const currency = currencyConversion(source);
    if (currency) {
      if (!rates) return {text:t('block.exchangeRatesUnavailable')};
      const [amount, from, to] = currency;
      if (rates.values[from] && rates.values[to]) return {value:Number(amount) * rates.values[to] / rates.values[from], text:`${formatNumber(Number(amount) * rates.values[to] / rates.values[from])} ${to}`, rateDate:rates.date};
      return {text:t('block.unsupportedCurrency')};
    }
    const node = parseMathExpression(source);
    if (!node) return null;
    const value = bindMinute(node, scope).evaluate(new Map(Object.entries(scope)));
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
// Colour classes for a math block, as {line, from, to, kind}. Kinds: variable
// (from mathVariableRanges), number, function, unit, currency, operator,
// punctuation, equals (the "=" that asks for a result) and comment.
const mathToken = /(?<number>(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)|(?<name>[\p{L}_][\p{L}\p{N}_]*)|(?<operator>[-+*/^%×÷])|(?<punctuation>[(),])/giu;
const mathConstants = new Set(['pi','e','tau','phi']);
function nameKind(name, after, previous, currencies) {
  if (/^\s*\(/.test(after)) return allowedFunctions.has(name) ? 'function' : null;
  if (name === 'to' || name.toLowerCase() === 'of') return 'operator';
  if (name === 'in') return previous === 'number' ? 'unit' : 'operator';
  if (name === 'ans') return 'variable';
  if (mathConstants.has(name)) return 'number';
  if (/^[A-Z]{3}$/.test(name) && currencies.has(name)) return 'currency';
  return math.Unit.isValuelessUnit(name) ? 'unit' : null;
}
export function mathHighlights(lines, currencies = new Set()) {
  const ranges = mathVariableRanges(lines).map(range => ({...range, kind:'variable'}));
  const variables = new Set(ranges.map(range => `${range.line}:${range.from}`));
  let inFence = false;
  for (let index=0; index<lines.length; index++) {
    const line=lines[index], trimmed=line.trim();
    if (/^(```|~~~)/.test(trimmed)) { inFence=!inFence; continue; }
    if (!trimmed || inFence) continue;
    if (trimmed.startsWith('//')) { ranges.push({line:index, from:line.indexOf('//'), to:line.length, kind:'comment'}); continue; }
    const definition=/^(\s*)([\p{L}_][\p{L}\p{N}_]*)\s*:\s*(.+)$/u.exec(line);
    let start, end;
    if (definition) {
      const colon=line.indexOf(':', definition[1].length+definition[2].length);
      ranges.push({line:index, from:colon, to:colon+1, kind:'punctuation'});
      start=colon+1; end=line.length;
    } else if (trimmed.endsWith('=')) {
      start=0; end=line.lastIndexOf('=');
      ranges.push({line:index, from:end, to:end+1, kind:'equals'});
    } else continue;
    let previous=null;
    for (const match of line.slice(start,end).matchAll(mathToken)) {
      const from=start+match.index, to=from+match[0].length;
      let kind=match.groups.number ? 'number' : match.groups.operator ? 'operator' : match.groups.punctuation ? 'punctuation' : null;
      if (match.groups.name) {
        if (variables.has(`${index}:${from}`)) { previous='variable'; continue; }
        kind=nameKind(match[0], line.slice(to,end), previous, currencies);
      }
      previous=kind;
      if (kind) ranges.push({line:index, from, to, kind});
    }
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
      // A number stands alone: not joined to other digits by . - : / (1.2.3.4,
      // 192.168.1.10, 2026-11-19, 14:05 and 10/2 are not amounts).
      // A numbering marker at the line start ("1.", "12.", "1.2.", "1)") is not an amount.
      const amounts=line.replace(/^\d+(?:\.\d+)*[.)](?=\s|$)/,'');
      for (const match of amounts.matchAll(/(?<![\p{L}\p{N}_.:/-])[-+]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?![\p{L}\p{N}_]|[.:/-]\d)/gu)) values.push(Number(match[0].replaceAll(',','')));
    }
  }
  if (mode === 'count') {
    const content=lines.slice(1).filter(x=>x.trim() && !/^\s*\/\//.test(x));
    const joined=content.join('\n');
    const words=typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined,{granularity:'word'}).segment(joined)].filter(x=>x.isWordLike).length : (joined.match(/[\p{L}\p{N}]+/gu)||[]).length;
    const chars=typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(joined)].length : Array.from(joined).length;
    return {mode, results, stats: {items: content.length, words, chars}, summary:t('block.countSummary').replace('{items}',content.length).replace('{words}',words).replace('{chars}',chars)};
  }
  const total=values.reduce((a,b)=>a+b,0);
  const summary=mode==='sum' ? t('block.sumSummary') : mode==='avg' ? t('block.averageSummary') : '';
  const count = values.length, average = count ? total / count : null;
  const stats = mode === 'sum' ? { count, total: Number.isFinite(total) ? total : null }
    : mode === 'avg' ? { count, average: Number.isFinite(average) ? average : null } : undefined;
  return {mode,results,summary:summary.replace('{total}',mode==='avg' ? (count ? formatNumber(average) : '—') : formatNumber(total)).replace('{count}',count), ...(stats && {stats})};
}
// Lines (1-based) that belong to blocks inside a whole-note mode, markers
// included. The note's own mode leaves them to their block.
export function nestedLines(scopes) {
  const nested=new Set();
  for(const scope of scopes) if(!scope.global) for(let n=scope.start;n<=scope.end;n++) nested.add(n);
  return nested;
}
// Pass the scopes when they are already known (scopesOf(state.doc)).
export function analyzeScopes(text,rates=null,scopes=scopesOf(text)) {
  const lines=text.split('\n'), nested=nestedLines(scopes);
  return scopes.map(scope=>{
    if(scope.mode==='code') return {...scope,results:[],summary:''};
    if(scope.global) return {...scope,...analyze(lines.map((line,i)=>nested.has(i+1) ? '' : line).join('\n'),rates)};
    const body=lines.slice(scope.start,Math.min(scope.last,lines.length));
    const info=analyze([scope.mode,...body].join('\n'),rates);
    return {...scope,...info,results:info.results.map(r=>({...r,line:scope.start+r.line-1}))};
  });
}
