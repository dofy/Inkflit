import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { headingDecorations } from '../web/typography.js';

test('Markdown headings get their own levels without changing code or text', () => {
  const doc = ['# One','## Two','### Three','#### Four','##### Five','###### Six','Setext','===','Other','---','```js','# code','```',':::quicknote code js','# block code',':::end','###not a heading'].join('\n');
  const state = EditorState.create({doc, extensions:[markdown()]});
  const actual = [];
  headingDecorations(state, [{from:0,to:doc.length}]).between(0,doc.length,(from,to,decoration) => {
    actual.push([state.doc.lineAt(from).text, decoration.spec.class]);
  });
  assert.deepEqual(actual, [
    ['# One','cm-note-heading cm-note-heading-1'], ['## Two','cm-note-heading cm-note-heading-2'],
    ['### Three','cm-note-heading cm-note-heading-3'], ['#### Four','cm-note-heading cm-note-heading-4'],
    ['##### Five','cm-note-heading cm-note-heading-5'], ['###### Six','cm-note-heading cm-note-heading-6'],
    ['Setext','cm-note-heading cm-note-heading-1'], ['Other','cm-note-heading cm-note-heading-2']
  ]);
  assert.equal(state.doc.toString(),doc);
});

test('inline code gets a chip, fenced and block code do not', async () => {
  const { inlineCodeDecorations } = await import('../web/typography.js');
  const doc = ['Use `npm ci` and `npm test`.','```js','const a = `x`;','```',':::quicknote code js','`raw`',':::end','plain'].join('\n');
  const state = EditorState.create({doc, extensions:[markdown()]});
  const marked = [];
  inlineCodeDecorations(state, [{from:0,to:doc.length}]).between(0,doc.length,(from,to) => { marked.push(doc.slice(from,to)); });
  assert.deepEqual(marked, ['`npm ci`','`npm test`']);
});
