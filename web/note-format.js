import { isolateHistory } from '@codemirror/commands';
import { app } from './app.js';
import { normalizeIndentation } from './code-editing.js';
import { sameMathExpression, scopeAt, scopesOf } from './features.js';

const expressionToken = /(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[\p{L}_][\p{L}\p{N}_]*|[+\-*/^×÷%(),]|\s+/giu;
const name = /^[\p{L}_]/u;
const wordOperators = new Set(['to', 'in', 'of']);
const needsOperand = new Set(['(', ',', '+', '-', '*', '/', '^', '×', '÷', ...wordOperators]);
const tightOnLeft = new Set([')', ',', '%']);

function spaceExpression(expression) {
  const parts = expression.match(expressionToken);
  if (!parts || parts.join('') !== expression) return expression;
  let result = '', previous = '', previousUnary = false;
  for (const part of parts) {
    if (!part.trim()) continue;
    const call = part === '(' && name.test(previous) && !wordOperators.has(previous.toLowerCase());
    if (previous && previous !== '(' && !previousUnary && !tightOnLeft.has(part) && !call) result += ' ';
    result += part;
    previousUnary = (part === '+' || part === '-') && (!previous || needsOperand.has(previous.toLowerCase()));
    previous = part;
  }
  return result;
}

function formatMathLine(line) {
  const indentation = /^\s*/.exec(line)[0], text = line.trim();
  const assignment = /^([\p{L}_][\p{L}\p{N}_]*)\s*:\s*(.+)$/u.exec(text);
  if (!assignment && !text.endsWith('=')) return line;
  const expression = assignment ? assignment[2] : text.slice(0, -1).trimEnd();
  const formatted = spaceExpression(expression);
  if (!sameMathExpression(expression, formatted)) return line;
  return indentation + (assignment ? `${assignment[1]}: ${formatted}` : `${formatted} =`);
}

const languageParsers = new Map([
  ['javascript', 'babel'], ['js', 'babel'], ['jsx', 'babel'], ['mjs', 'babel'], ['cjs', 'babel'],
  ['typescript', 'typescript'], ['ts', 'typescript'], ['tsx', 'typescript'],
  ['json', 'json'], ['jsonc', 'jsonc'],
  ['html', 'html'], ['css', 'css'], ['scss', 'scss'], ['less', 'less'],
  ['markdown', 'markdown'], ['md', 'markdown'], ['yaml', 'yaml'], ['yml', 'yaml'],
]);
const babel = () => import('prettier/plugins/babel');
const estree = () => import('prettier/plugins/estree');
const postcss = () => import('prettier/plugins/postcss');
const parserPlugins = {
  babel: [babel, estree],
  typescript: [() => import('prettier/plugins/typescript'), estree],
  json: [babel, estree],
  jsonc: [babel, estree],
  html: [() => import('prettier/plugins/html')],
  css: [postcss],
  scss: [postcss],
  less: [postcss],
  markdown: [() => import('prettier/plugins/markdown')],
  yaml: [() => import('prettier/plugins/yaml')],
};

async function formatCodeBlock(doc, scope, indentation) {
  if (!scope.global && !scope.closed) return null;
  const opening = doc.line(scope.start).text;
  const fence = scope.kind === 'fence';
  const info = fence ? opening.trimStart().slice(scope.marker.length).trim().split(/\s+/, 1)[0] : '';
  const language = scope.language || info.replace(/^code:/i, '');
  const parser = languageParsers.get(language.toLowerCase());
  if (!parser) return null;

  // Indentation outside a Markdown fence belongs to the surrounding document.
  const prefix = fence ? /^[\t ]*/.exec(opening)[0] : '';
  const from = doc.line(scope.start + 1).from, to = doc.line(scope.last).to;
  const original = doc.sliceString(from, to), lines = original.split('\n');
  if (!original.trim() || lines.some(line => line.trim() && !line.startsWith(prefix))) return null;
  const code = lines.map(line => line.startsWith(prefix) ? line.slice(prefix.length) : '').join('\n');
  try {
    const [{ format }, ...plugins] = await Promise.all([import('prettier/standalone'), ...parserPlugins[parser].map(load => load())]);
    const formatted = await format(code, {
      parser, plugins, useTabs: indentation === 'tabs', tabWidth: indentation === 'spaces4' ? 4 : 2,
      embeddedLanguageFormatting: 'off',
    });
    const body = formatted.replace(/\n$/, '').split('\n').map(line => line ? prefix + line : '');
    const closesBlock = fence ? new RegExp(`^\\s*${scope.marker[0]}{${scope.marker.length},}\\s*$`) : /^:::end\s*$/;
    if (!scope.global && body.some(line => closesBlock.test(line))) return null;
    const insert = body.join('\n');
    return insert === original ? null : { from, to, insert };
  } catch (_) {
    // An incomplete snippet or unsupported syntax is still editable as written.
    return null;
  }
}

export async function planNoteFormat(doc, codeIndentation) {
  const changes = [], code = [], indentation = normalizeIndentation(codeIndentation);
  for (const scope of scopesOf(doc)) {
    if (scope.start >= scope.last) continue;
    if (scope.mode === 'code') {
      code.push(formatCodeBlock(doc, scope, indentation));
    } else if (scope.mode === 'math') {
      for (let n = scope.start + 1; n <= scope.last; n++) {
        if (scopeAt(doc, n) !== scope) continue;
        const line = doc.line(n), insert = formatMathLine(line.text);
        if (insert !== line.text) changes.push({ from: line.from, to: line.to, insert });
      }
    }
  }
  return [...changes, ...(await Promise.all(code)).filter(Boolean)].sort((a, b) => a.from - b.from);
}

export async function formatCurrentNote() {
  const editor = app.editor;
  if (!editor) return;
  const doc = editor.state.doc;
  const changes = await planNoteFormat(doc, app.codeIndentation);
  // The user may have edited the note or switched away while formatting code.
  if (changes.length && app.editor === editor && editor.state.doc === doc) {
    editor.dispatch({ changes, userEvent: 'input.format', annotations: isolateHistory.of('full') });
  }
}
