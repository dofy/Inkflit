import { isolateHistory } from '@codemirror/commands';
import { ChangeSet, Text } from '@codemirror/state';
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

function diffLines(doc, first, last) {
  const rows = [];
  for (let number = first; number <= last; number++) {
    const { text } = doc.line(number);
    const newline = number < doc.lines;
    if (text || newline) rows.push({ text, newline });
  }
  return rows;
}

function formatDiff(before, after, changes) {
  const output = ['--- before', '+++ after'];
  const equal = (a, b) => a.text === b.text && a.newline === b.newline;
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const startA = before.lineAt(fromA).number, startB = after.lineAt(fromB).number;
    const oldLines = diffLines(before, startA, before.lineAt(toA).number);
    const newLines = diffLines(after, startB, after.lineAt(toB).number);
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && equal(oldLines[prefix], newLines[prefix])) prefix++;
    while (oldLines.length > prefix && newLines.length > prefix && equal(oldLines.at(-1), newLines.at(-1))) {
      oldLines.pop(); newLines.pop();
    }
    const removed = oldLines.slice(prefix), added = newLines.slice(prefix);
    const range = (start, length) => `${start + prefix - (length ? 0 : 1)},${length}`;
    output.push(`@@ -${range(startA, removed.length)} +${range(startB, added.length)} @@`);
    for (const [sign, lines] of [['-', removed], ['+', added]]) {
      for (const { text, newline } of lines) {
        output.push(sign + text);
        if (!newline) output.push('\\ No newline at end of file');
      }
    }
  });
  return output.join('\n') + '\n';
}

// CodeMirror uses LF internally. Preserve the stored separators outside the
// changed ranges, including CRLF notes imported without opening them first.
function preserveLineEndings(source, doc, after, changes) {
  if (!source.includes('\r')) return after.toString();
  const separators = source.match(/\r\n?|\n/g) ?? [], offsets = [0];
  for (let i = 0; i < separators.length; i++) offsets.push(offsets[i] + (separators[i].length - 1));
  const parts = [];
  let previous = 0;
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    const first = doc.lineAt(from).number - 1, last = doc.lineAt(to).number - 1;
    const start = from + offsets[first], end = to + offsets[last];
    const separator = separators[first] ?? separators[first - 1] ?? '\n';
    parts.push(source.slice(previous, start), inserted.toString().replaceAll('\n', separator));
    previous = end;
  });
  parts.push(source.slice(previous));
  return parts.join('');
}

export async function previewNoteFormat(content, indentation) {
  const doc = Text.of(content.split(/\r\n?|\n/));
  const plan = await planNoteFormat(doc, indentation);
  if (!plan.length) return null;
  const changes = ChangeSet.of(plan, doc.length), after = changes.apply(doc);
  return { doc, changes, content: preserveLineEndings(content, doc, after, changes), diff: formatDiff(doc, after, changes) };
}

export function noteFormatTransaction(changes) {
  return { changes, userEvent: 'input.format', annotations: [isolateHistory.of('full')] };
}

export async function formatCurrentNote() {
  const editor = app.editor;
  if (!editor) return;
  const doc = editor.state.doc;
  const changes = await planNoteFormat(doc, app.codeIndentation);
  // The user may have edited the note or switched away while formatting code.
  if (changes.length && app.editor === editor && editor.state.doc === doc) {
    editor.dispatch(noteFormatTransaction(changes));
  }
}
