import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { commentChanges, isCodeAt } from '../web/comments.js';
import { markdownBlockMarkers } from '../web/features.js';

const docState = (doc, selection = 0) => EditorState.create({doc, selection:typeof selection === "number" ? {anchor:selection} : selection, extensions:[markdown()]});
const toggle = state => state.update({changes:commentChanges(state)}).state;

test('typing a dash after a feature block leaves its contents out of Markdown headings', () => {
  const doc = 'Normal heading\n---\n:::inkflit list\nfirst\n**second**\n:::end\n';
  const state = EditorState.create({ doc, extensions: [markdown({ extensions: markdownBlockMarkers })] });
  for (const [input, node] of [['-', 'BulletList'], ['- next', 'BulletList'], ['---', 'HorizontalRule']]) {
    const edited = state.update({ changes: { from: doc.length, insert: input } }).state;
    const root = syntaxTree(edited).topNode;
    assert.equal(root.firstChild.name, 'SetextHeading2', 'an ordinary Markdown heading still works');
    assert.equal(root.getChild('Paragraph').getChild('StrongEmphasis').name, 'StrongEmphasis', 'inline Markdown inside the feature block still works');
    assert.equal(root.lastChild.name, node);
  }
});

test('comments a line after indentation and uncomments it again', () => {
  const initial = docState('  中文 task\nhttps://example.com', 3);
  const commented = toggle(initial);
  assert.equal(commented.doc.toString(), '  // 中文 task\nhttps://example.com');
  assert.equal(toggle(commented).doc.toString(), initial.doc.toString());
});
test('toggles selected lines without changing an unselected line at the selection boundary', () => {
  const source = 'first\nsecond\nthird';
  let state = docState(source, {anchor:0, head:13});
  state = toggle(state);
  assert.equal(state.doc.toString(), '// first\n// second\nthird');
  assert.equal(toggle(state).doc.toString(), source);
});
test('preserves comments, code fences, and ordinary URLs in a mixed selection', () => {
  const source = '// already\nnext\n```js\nconst url = "https://a";\n// real code comment\n```\nlast';
  const initial = docState(source, EditorSelection.range(0,source.length));
  const edited = toggle(initial);
  assert.equal(edited.doc.toString(), '// already\n// next\n```js\nconst url = "https://a";\n// real code comment\n```\n// last');
  assert.equal(isCodeAt(initial, source.indexOf('// real code')), true);
  assert.equal(isCodeAt(initial, source.indexOf('// already')), false);
});
test('blank or entirely fenced lines are not changed', () => {
  assert.deepEqual(commentChanges(docState('  ', 0)), []);
  const source = '```python\nprint(1)\n```';
  assert.deepEqual(commentChanges(docState(source, source.indexOf('print'))), []);
});

test('fallback comments an unknown code block without touching its fences', () => {
  const source = '```unknown\nsome text\n```';
  let state = docState(source, source.indexOf('some'));
  state = state.update({changes:commentChanges(state, {includeCode:true})}).state;
  assert.equal(state.doc.toString(), '```unknown\n// some text\n```');
  assert.equal(state.update({changes:commentChanges(state, {includeCode:true})}).state.doc.toString(), source);
  assert.deepEqual(commentChanges(docState(source, 0), {includeCode:true}), []);
});

test('comments inside a Python feature block use the language syntax', async () => {
  const {blockCodeCommentChanges, isCodeAt}=await import('../web/comments.js');
  const doc=':::inkflit code python\n  print(1)\n:::end';
  const state=docState(doc,doc.indexOf('print'));
  assert.equal(isCodeAt(state,doc.indexOf('print')),true);
  assert.deepEqual(blockCodeCommentChanges(state),[{from:doc.indexOf('print'),insert:'# '}]);
});
